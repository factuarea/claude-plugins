"""Check that what the skills and READMEs cite exists in the published contract.

Reads files that are NOT stored in this repository (the OpenAPI document alone
is about 24 MB) and fails when a skill or README names something they do not
contain:

  --spec           OpenAPI document (operationIds, routes, header names)
  --mcp-catalog    MCP tool catalog: JSON list of {name, domain, scope, ...};
                   `scope` is one scope or a list of scopes that are ALL required
  --error-catalog  error catalog: JSON object {"error_codes": [{code, http_status, ...}]}

and, optionally:

  --stats          API and MCP counts: JSON object {"mcp": {"tools_total",
                   "tools_by_domain", "oauth_reachable", "oauth_restricted"}}
  --mcp-tools      published tools: JSON object {"tools": [{name, domain,
                   oauth_reachable}]}, the list that `tools_total` counts
  --php-src        the PHP SDK checkout, to check the generated method names and
                   the hand-written helpers that the PHP recipes call.

What is checked, in every plugins/**/SKILL.md, plugins/*/README.md and README.md:

  * operationIds (`public-api.v1.…`);
  * routes written as `METHOD /path` (alternatives such as `{invoices|quotes}`
    are expanded), and backticked `/path` whose first segment belongs to a known
    API family; a company resource cited without its `/companies/{company}`
    segment is reported as outside the company axis;
  * scopes (`resource:action` in backticks);
  * error codes: a backticked snake_case token that follows an HTTP status, or
    that starts like a catalog code and is not a known field name; a known code
    cited right after a status other than its catalog `http_status` fails too;
  * MCP tool names: a backticked snake_case token that starts with a catalog verb
    and is neither a field name nor an error code;
  * HTTP header names that the contract defines (`X-…`, `If-…`, `Retry-After`, …);
  * with --stats and --mcp-tools: every tool and domain count in the prose
    (`664 tools`, `41 domains`, `540 are reachable…`) and every row of a
    `| Domain | Tools | OAuth | Scopes |` table, against the measured catalog;
  * PHP SDK method names and helper classes (with --php-src);
  * factuarea-audit lists every client flow CE01 to CE25 and no other.

It does not run anything against an account and needs no network.

  python3 scripts/test_document_template_contracts.py \\
      --spec openapi.json --mcp-catalog mcp-catalog.json \\
      --error-catalog error-catalog.json \\
      [--stats stats.json --mcp-tools mcp-tools.json] [--php-src ../factuarea-php/src]
"""
import argparse
import collections
import itertools
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
METHODS = ('get', 'post', 'put', 'patch', 'delete')
STANDARD_HEADERS = {
    'Authorization', 'Content-Type', 'Accept', 'ETag', 'If-Match', 'If-None-Match', 'Retry-After',
    'Cache-Control', 'Content-Disposition', 'Location', 'Sunset', 'Deprecation', 'Link', 'User-Agent',
    'If-Modified-Since', 'If-Unmodified-Since', 'If-Range', 'Last-Modified', 'Vary', 'Accept-Language',
}
# Headers the API sends that the OpenAPI document does not describe: its webhook
# block covers company deliveries only, and account deliveries add this one.
EXTRA_HEADERS = {'Factuarea-Account-Relationship'}
# Names the skills cite only to say they no longer exist (retired resources,
# renamed operations, tools that were never published).
RETIRED = {
    '/v1/companies/{company}/clients',
    'public-api.v1.account.claim_tokens.list',
    'search_clients',
    'create_client',
}
# Codes of the MCP JSON-RPC mapping that the REST error catalog does not list
# (https://docs.factuarea.com/mcp/errors).
MCP_ERRORS = {'module_not_in_plan'}
# Arguments of MCP tools: the catalog does not carry input schemas.
MCP_ARGUMENTS = {'idempotency_key'}
SNAKE = re.compile(r'^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$')
AXIS = '/companies/{}'


def norm_path(path):
    path = path.split('?')[0].rstrip('.,;:)')
    path = re.sub(r'^/v\d+(?=/)', '', path)
    path = re.sub(r'\{[^}]*\}', '{}', path)
    return path.rstrip('/') or '/'


def expand(route):
    """`/v1/{invoices|quotes}/{id}/pdf` → one path per alternative."""
    parts = re.split(r'\{([A-Za-z0-9_\-]+(?:\|[A-Za-z0-9_\-]+)+)\}', route)
    options = [part.split('|') if i % 2 else [part] for i, part in enumerate(parts)]
    return [''.join(combo) for combo in itertools.product(*options)]


def collect_names(node, out):
    """Every property name and parameter name anywhere in the spec."""
    if isinstance(node, dict):
        props = node.get('properties')
        if isinstance(props, dict):
            out.update(props)
        if isinstance(node.get('name'), str) and node.get('in') in ('query', 'header', 'path', 'cookie'):
            out.add(node['name'])
        if isinstance(node.get('const'), str):
            out.add(node['const'])
        if isinstance(node.get('enum'), list):
            out.update(v for v in node['enum'] if isinstance(v, str))
        for value in node.values():
            collect_names(value, out)
    elif isinstance(node, list):
        for value in node:
            collect_names(value, out)


def scopes_of(tool):
    scope = tool.get('scope')
    return scope if isinstance(scope, list) else [scope] if scope else []


def load_universe(args):
    spec_text = Path(args.spec).read_text()
    spec = json.loads(spec_text)
    u = {'routes': set(), 'paths': set(), 'op_ids': set(), 'op_segments': set(), 'names': set(), 'scopes': set()}
    for path, item in spec['paths'].items():
        u['paths'].add(norm_path(path))
        for method, op in item.items():
            if method not in METHODS:
                continue
            u['routes'].add((method.upper(), norm_path(path)))
            u['op_ids'].add(op['operationId'])
            u['op_segments'].update(re.split(r'[.\-]', op['operationId']))
            if op.get('x-required-scope'):
                u['scopes'].add(op['x-required-scope'])
    collect_names(spec, u['names'])
    u['names'] |= MCP_ARGUMENTS
    u['first_segments'] = {p.split('/')[1] for p in u['paths'] if p.count('/') >= 1 and p != '/'}
    u['headers'] = set(re.findall(r'\b[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+\b', spec_text)) | STANDARD_HEADERS | EXTRA_HEADERS

    catalog = json.loads(Path(args.mcp_catalog).read_text())
    u['catalog'] = {t['name']: t for t in catalog}
    u['tools'] = set(u['catalog'])
    u['verbs'] = {name.split('_')[0] for name in u['tools']}
    for tool in catalog:
        u['scopes'].update(scopes_of(tool))

    errors = json.loads(Path(args.error_catalog).read_text())['error_codes']
    u['errors'] = {e['code'] for e in errors} | MCP_ERRORS
    u['error_prefixes'] = {e['code'].split('_')[0] for e in errors}
    u['statuses'] = {e['code']: e.get('http_status') for e in errors}

    u['scope_actions'] = {s.split(':')[1] for s in u['scopes']}

    if args.php_src:
        src = Path(args.php_src)
        methods = set()
        for php in src.glob('*.php'):
            methods.update(re.findall(r'public function (publicApiV1\w+)\(', php.read_text()))
        u['php_methods'] = methods
        u['php_custom'] = {p.stem for p in (src / 'Custom').rglob('*.php')}
    return u


def path_known(u, n):
    return n in u['paths'] or any(p.startswith(n + '/') for p in u['paths'])


def files_to_check():
    files = [ROOT / 'README.md']
    files += sorted(ROOT.glob('plugins/*/README.md'))
    files += sorted(ROOT.glob('plugins/*/skills/*/SKILL.md'))
    return files


def check_text(path, text, u, findings):
    rel = path.relative_to(ROOT)

    def add(line_no, kind, token, detail=''):
        findings.append(f'{rel}:{line_no}: {kind} `{token}`{(" — " + detail) if detail else ""}')

    for line_no, line in enumerate(text.splitlines(), 1):
        for op_id in re.findall(r'public-api\.v1\.[A-Za-z0-9_.\-]*[A-Za-z0-9_]', line):
            if op_id not in u['op_ids'] and op_id not in RETIRED:
                add(line_no, 'unknown operationId', op_id)

        for method, route in re.findall(r'\b(GET|POST|PUT|PATCH|DELETE)\s+`?(/[A-Za-z0-9_\-{}/.:|]*)', line):
            if '...' in route or '{resource}' in route or route.rstrip('/') in ('', '/v1'):
                continue
            for variant in expand(route):
                n = norm_path(variant)
                if (method, n) in u['routes'] or variant in RETIRED:
                    continue
                if (method, AXIS + n) in u['routes']:
                    add(line_no, 'route outside the company axis', f'{method} {variant}',
                        f'the spec has {method} /v1/companies/{{company}}{n}')
                else:
                    add(line_no, 'route not in the spec', f'{method} {variant}')

        for token in re.findall(r'`([^`\n]+)`', line):
            token = token.strip()
            if re.fullmatch(r'/[a-z{][A-Za-z0-9_\-{}/|]*', token):
                if token in RETIRED or '{resource}' in token:
                    continue
                for variant in expand(token):
                    n = norm_path(variant)
                    first = n.split('/')[1] if n.count('/') >= 1 else ''
                    if path_known(u, n):
                        continue
                    if path_known(u, AXIS + n):
                        add(line_no, 'path outside the company axis', variant,
                            f'the spec has /v1/companies/{{company}}{n}')
                    elif first in u['first_segments']:
                        add(line_no, 'path not in the spec', variant)
            elif re.fullmatch(r'[1-5]\d\d [a-z][a-z0-9_]*', token):
                status, code = token.split(' ')
                if code in u['errors']:
                    expected = u['statuses'].get(code)
                    if expected and int(status) != expected:
                        add(line_no, 'error code with the wrong status', token, f'the error catalog gives it {expected}')
                elif SNAKE.match(code) and code not in u['names']:
                    add(line_no, 'unknown error code', code)
            elif re.fullmatch(r'[a-z_]+:[a-z_]+', token) and token.split(':')[1] in u['scope_actions']:
                if token not in u['scopes']:
                    add(line_no, 'unknown scope', token)
            elif SNAKE.match(token):
                if token in RETIRED:
                    continue
                status = re.search(r'\b([1-5]\d\d)\s+`' + re.escape(token) + '`', line)
                if token in u['errors']:
                    expected = u['statuses'].get(token)
                    if status and expected and int(status.group(1)) != expected:
                        add(line_no, 'error code with the wrong status', f'{status.group(1)} {token}',
                            f'the error catalog gives it {expected}')
                    continue
                known_field = token in u['names'] or token in u['tools'] or token in u['op_segments']
                if status and not known_field:
                    add(line_no, 'unknown error code', token)
                elif not known_field and token.split('_')[0] in u['verbs'] and token not in u['tools']:
                    add(line_no, 'unknown MCP tool', token)
                elif (not known_field and token.split('_')[0] in u['error_prefixes']
                      and re.search(r'\b(errors?|codes?|[1-5]\d\d)\b', line, re.I)):
                    add(line_no, 'unknown error code', token)
            elif re.fullmatch(r'publicApiV1\w+', token) and 'php_methods' in u:
                if token not in u['php_methods']:
                    add(line_no, 'PHP SDK method not generated', token, 'cite the operation as METHOD /path instead')

        for header in re.findall(r'\b((?:X|If|Idempotent|Factuarea|RateLimit)-[A-Za-z0-9-]+|Retry-After)\b', line):
            if header not in u['headers']:
                add(line_no, 'header not in the contract', header)

        if 'php_custom' in u:
            for klass in re.findall(r'\b(RawRequest|RequestOverridesClient|RequestOverrides|ResponseMeta|NoRetry)\b', line):
                if klass not in u['php_custom']:
                    add(line_no, 'PHP helper missing in src/Custom', klass)

    # A `status code` span wrapped over two lines escapes the line-by-line scan.
    for match in re.finditer(r'`([1-5]\d\d)[ \t]*\n[ \t]*([a-z][a-z0-9_]*)`', text):
        status, code = match.groups()
        line_no = text.count('\n', 0, match.start()) + 1
        if code in u['errors']:
            expected = u['statuses'].get(code)
            if expected and int(status) != expected:
                add(line_no, 'error code with the wrong status', f'{status} {code}', f'the error catalog gives it {expected}')
        elif SNAKE.match(code) and code not in u['names']:
            add(line_no, 'unknown error code', code)


def load_counts(args, u, findings):
    """Measured tool counts: totals from --stats, per-domain reach from --mcp-tools."""
    stats = json.loads(Path(args.stats).read_text())['mcp']
    tools = json.loads(Path(args.mcp_tools).read_text())['tools']
    by_domain = collections.defaultdict(list)
    for tool in tools:
        by_domain[tool['domain']].append(tool)

    # The two exports describe the same listing; refuse to measure against a mix.
    if len(tools) != stats['tools_total']:
        findings.append(f'--mcp-tools lists {len(tools)} tools but --stats says {stats["tools_total"]}')
    if sum(t['oauth_reachable'] for t in tools) != stats['oauth_reachable']:
        findings.append('--mcp-tools and --stats disagree on the tools reachable by OAuth')
    if {d: len(ts) for d, ts in by_domain.items()} != stats['tools_by_domain']:
        findings.append('--mcp-tools and --stats disagree on the tools of each domain')
    missing = sorted(t['name'] for t in tools if t['name'] not in u['catalog'])
    if missing:
        findings.append(f'tools published but absent from --mcp-catalog: {", ".join(missing)}')

    rows = collections.Counter()
    for domain, members in by_domain.items():
        reach = collections.defaultdict(bool)
        for tool in members:
            for scope in scopes_of(u['catalog'].get(tool['name'], {})):
                reach[scope] |= tool['oauth_reachable']
        oauth = sum(t['oauth_reachable'] for t in members)
        rows[(len(members), 'all' if oauth == len(members) else str(oauth),
              frozenset((scope, not reachable) for scope, reachable in reach.items()))] += 1
    return {
        'total': stats['tools_total'],
        'oauth': stats['oauth_reachable'],
        'restricted': stats['oauth_restricted'],
        'domains': len(by_domain),
        'rows': rows,
    }


def check_counts(path, text, c, findings):
    rel = path.relative_to(ROOT)
    claims = (
        (r'(\d+)\s+tools\b', {c['total'], c['oauth']}, 'tool count'),
        (r'\breaches\s+(\d+)', {c['total'], c['oauth']}, 'tool count'),
        (r'(\d+)\s+(?:are|sit)\b', {c['oauth'], c['restricted']}, 'OAuth split'),
        (r'(\d+)\s+(?:tool\s+)?domains\b', {c['domains']}, 'domain count'),
        (r'[Tt]ool domains\s+\((\d+)\)', {c['domains']}, 'domain count'),
    )
    lines = text.splitlines()
    for line_no, line in enumerate(lines, 1):
        plain = line.replace('**', '')
        for pattern, expected, kind in claims:
            for match in re.finditer(pattern, plain):
                value = int(match.group(1))
                if kind != 'domain count' and value < 100:
                    continue  # small numbers are breakdowns, not totals
                if value not in expected:
                    findings.append(f'{rel}:{line_no}: {kind} `{match.group(0)}` — measured: '
                                    f'{", ".join(str(v) for v in sorted(expected))}')

    for start, line in enumerate(lines):
        if not re.fullmatch(r'\|\s*Domain\s*\|\s*Tools\s*\|\s*OAuth\s*\|\s*Scopes\s*\|', line.strip()):
            continue
        cited = collections.Counter()
        total = 0
        for row_no in range(start + 2, len(lines)):
            row = lines[row_no].strip()
            if not row.startswith('|'):
                break
            cells = [cell.strip() for cell in row.strip('|').split('|')]
            scopes = frozenset((scope, bool(flag)) for scope, flag in
                               re.findall(r'`([a-z_]+:[a-z_]+)`(\s*\*\(API key only\)\*)?', cells[3]))
            key = (int(cells[1]), cells[2], scopes)
            total += key[0]
            cited[key] += 1
            if c['rows'][key] < cited[key]:
                findings.append(f'{rel}:{row_no + 1}: domain row `{cells[0]}` does not match any measured '
                                f'domain (tools, OAuth reach and scopes)')
        for key, count in (c['rows'] - cited).items():
            findings.append(f'{rel}:{start + 1}: domain table lacks a measured domain with {key[0]} tools, '
                            f'OAuth {key[1]} and scopes {", ".join(sorted(s for s, _ in key[2]))}')
        if total != c['total']:
            findings.append(f'{rel}:{start + 1}: domain table adds up to {total} tools, measured {c["total"]}')


def check_audit_flows(findings):
    audit = ROOT / 'plugins/factuarea-api/skills/factuarea-audit/SKILL.md'
    found = set(re.findall(r'\bCE(\d\d)\b', audit.read_text()))
    expected = {f'{n:02d}' for n in range(1, 26)}
    for missing in sorted(expected - found):
        findings.append(f'{audit.relative_to(ROOT)}: client flow CE{missing} is not listed')
    for extra in sorted(found - expected):
        findings.append(f'{audit.relative_to(ROOT)}: CE{extra} is not a client flow (CE01 to CE25)')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--mcp-catalog', required=True)
    parser.add_argument('--error-catalog', required=True)
    parser.add_argument('--stats')
    parser.add_argument('--mcp-tools')
    parser.add_argument('--php-src')
    args = parser.parse_args()
    if bool(args.stats) != bool(args.mcp_tools):
        parser.error('--stats and --mcp-tools go together')

    universe = load_universe(args)
    findings = []
    counts = load_counts(args, universe, findings) if args.stats else None
    files = files_to_check()
    for path in files:
        text = path.read_text()
        check_text(path, text, universe, findings)
        if counts:
            check_counts(path, text, counts, findings)
    check_audit_flows(findings)

    if findings:
        print('\n'.join(findings))
        print(f'\n{len(findings)} problem(s) in {len(files)} files.')
        return 1
    print(f'OK: {len(files)} files checked against {len(universe["op_ids"])} operations, '
          f'{len(universe["tools"])} tools and {len(universe["errors"])} error codes'
          + (f'; counts against {counts["total"]} published tools in {counts["domains"]} domains.' if counts else '.'))
    return 0


if __name__ == '__main__':
    sys.exit(main())

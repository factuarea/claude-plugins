"""Validate only the self-contained plugin's format, schemas and native consumer contract.

No network, plugin installation, API/MCP calls, credentials, database or app runtime.
Optional --native-root checks the exactly recorded Source files, never discovery.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCOPES = {
    'automation:read', 'automation:write', 'booking:read', 'booking:write',
    'tasks:read', 'tasks:write', 'tasks:delete',
    'crm_leads:read', 'crm_leads:write', 'crm_pipelines:read',
    'crm_opportunities:read', 'crm_opportunities:write',
    'crm_activities:read', 'crm_activities:write',
}
ORIGINALS = {
    'get_crm_sequence_original': 'save_crm_sequence',
    'get_crm_enrolment_original': 'enrol_crm_sequence',
    'recover_booking_service_receipt': 'save_booking_service',
}
EXPECTED_COUNTS = {'sequences': 9, 'bookings': 5, 'task-time': 8, 'commercial-journey': 9}


def require(value, message):
    if not value:
        raise ValueError(message)


def schema_validate(value, schema, path='$'):
    """Validate the local schemas' closed subset of JSON Schema 2020-12."""
    if 'const' in schema:
        require(type(value) is type(schema['const']) and value == schema['const'], path + ': const')
    if 'enum' in schema:
        require(value in schema['enum'], path + ': enum')
    if 'type' in schema:
        kinds = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
        matches = {
            'object': isinstance(value, dict), 'array': isinstance(value, list),
            'string': isinstance(value, str), 'null': value is None,
            'integer': type(value) is int, 'boolean': type(value) is bool,
        }
        require(any(matches.get(kind, False) for kind in kinds), path + ': type')
    if isinstance(value, dict):
        require(set(schema.get('required', [])) <= set(value), path + ': required')
        properties = schema.get('properties', {})
        if schema.get('additionalProperties') is False:
            require(set(value) <= set(properties), path + ': closed properties')
        for key, item in value.items():
            if key in properties:
                schema_validate(item, properties[key], path + '.' + key)
    if isinstance(value, list):
        require(len(value) >= schema.get('minItems', 0), path + ': minItems')
        require(len(value) <= schema.get('maxItems', len(value)), path + ': maxItems')
        if schema.get('uniqueItems'):
            require(len({json.dumps(item, sort_keys=True) for item in value}) == len(value), path + ': uniqueItems')
        for index, item in enumerate(value):
            schema_validate(item, schema.get('items', {}), f'{path}[{index}]')
    if isinstance(value, str):
        require(len(value) >= schema.get('minLength', 0), path + ': minLength')
        require(len(value) <= schema.get('maxLength', len(value)), path + ': maxLength')
        if 'pattern' in schema:
            require(re.search(schema['pattern'], value) is not None, path + ': pattern')


def validate_contract(contract):
    schema = json.loads((ROOT / 'schemas/plugin-contract.schema.json').read_text())
    schema_validate(contract, schema)
    tools = {entry['name']: entry for entry in contract['tools']}
    require(len(tools) == len(contract['tools']), 'Duplicate tool name')
    counts = {area: sum(item['area'] == area for item in tools.values()) for area in EXPECTED_COUNTS}
    require(counts == EXPECTED_COUNTS, 'Closed native area inventory')
    for tool in tools.values():
        require(tool['scope'] in SCOPES, 'Unknown or legacy scope')
        if tool['area'] == 'commercial-journey':
            owner = tool['source'].split('/')[2]
            prefix = {'Lead': 'crm_leads:', 'Pipeline': 'crm_pipelines:', 'Opportunity': 'crm_opportunities:', 'CrmActivity': 'crm_activities:'}[owner]
        else:
            prefix = {'sequences': 'automation:', 'bookings': 'booking:', 'task-time': 'tasks:'}[tool['area']]
        require(tool['scope'].startswith(prefix), 'Scope belongs to another native owner')
        require(not set(tool['required_arguments']) & set(tool['optional_arguments']), 'Overlapping arguments')
        require(not set(tool['required_arguments'] + tool['optional_arguments']) & {'company_id', 'sandbox', 'actor_id', 'role', 'effect_uuid'}, 'Caller cannot forge authority or original IDs')
        if tool['category'] != 'READ':
            require(tool['confirmation'] != 'none', 'Mutation needs human review')
        if tool['kind'] == 'control':
            require(tool['recovery_tool'] is None and 'idempotency_key' not in tool['required_arguments'], 'Control has no fabricated original replay')
    for original, mutation in ORIGINALS.items():
        query, effect = tools[original], tools[mutation]
        require(query['category'] == 'READ' and query['kind'] == 'original-query', 'Original must remain query-only')
        require(query['scope'] == effect['scope'] and query['scope'].endswith(':write'), 'Original retains owner WRITE privilege')
        require(query['original_for'] == mutation and effect['recovery_tool'] == original, 'Exact recovery pair')
        require(query['confirmation'] == 'none' and 'confirmed' not in query['required_arguments'] + query['optional_arguments'], 'Original query has no confirmation or effect')
    require(tools['recover_booking_service_receipt']['operation'] == 'booking.service_receipt', 'Actual native receipt operation')
    require(tools['start_task_timer']['required_arguments'] == ['task_id'] and tools['start_task_timer']['optional_arguments'] == [], 'Canonical timer has no invented fields')
    require(tools['stop_task_timer']['required_arguments'] == [] and tools['stop_task_timer']['optional_arguments'] == [], 'Stop current native timer')
    require(tools['delete_task_time_entry']['scope'] == 'tasks:delete' and tools['delete_task_time_entry']['category'] == 'DESTRUCTIVE', 'Native irreversible Task privilege')
    return tools


def validate_package(native_root=None):
    manifests = [json.loads((ROOT / path).read_text()) for path in ['plugin.json', '.claude-plugin/plugin.json']]
    contract = json.loads((ROOT / 'plugin-contract.json').read_text())
    tools = validate_contract(contract)
    require(ROOT.name == contract['package'], 'Contained package directory')
    for manifest in manifests:
        require(manifest['name'] == contract['package'] and manifest['version'] == contract['package_version'], 'Synchronized manifest identity/version')
        require(bool(re.fullmatch(r'[a-z][a-z0-9-]{0,63}', manifest['name'])), 'Plugin name')
        require(bool(re.fullmatch(r'\d+\.\d+\.\d+', manifest['version'])), 'Semantic version')
    require(not {'skills', 'mcpServers', 'apps', 'interface'} & set(manifests[0]), 'Portable manifest fixed locations')
    interface = manifests[0]['extensions']['com.openai']['interface']
    require(len(interface['shortDescription']) <= 30, 'Short description max 30')
    portable = json.loads((ROOT / 'mcp.json').read_text())['mcpServers']
    claude = json.loads((ROOT / '.mcp.json').read_text())['mcpServers']
    for servers, transport in [(portable, 'streamable-http'), (claude, 'http')]:
        require(set(servers) == {'factuarea'}, 'Only actual existing MCP server')
        require(servers['factuarea'] == {'type': transport, 'url': contract['server']['url']}, 'No invented auth/header/server')
    skills = sorted((ROOT / 'skills').glob('*/SKILL.md'))
    require(len(skills) == 5, 'Five own skills')
    for skill in skills:
        front = skill.read_text().split('---', 2)
        require(len(front) == 3 and not front[0].strip(), 'Skill frontmatter')
        require(f'name: {skill.parent.name}\n' in front[1] and 'description: ' in front[1], 'Matching skill identity/description')
    for path in ROOT.rglob('*'):
        require(not path.is_symlink(), 'No symlinks in package')
        if path.is_file():
            require(path.stat().st_mode & 0o777 == 0o644, 'Source file mode 0644')
            text = path.read_text()
            require(text.endswith('\n'), 'Final newline')
            require(all(line == line.rstrip() for line in text.splitlines()), 'No trailing whitespace')
            if path.suffix == '.json':
                obj = json.loads(text)
                require(text == json.dumps(obj, ensure_ascii=False, indent=2) + '\n', 'JSON formatting')
    source = json.loads((ROOT / 'crm/source-provenance.json').read_text())['native_source']
    commercial = json.loads((ROOT / 'skills/crm-commercial-journey/references/source-contract.json').read_text())
    source += commercial['native_tools']
    require({item['name']: (item['source'], item['source_sha256']) for item in source} == {name: (item['source'], item['source_sha256']) for name, item in tools.items()}, 'Exact native Source provenance')
    if native_root:
        native_root = Path(native_root).resolve()
        for item in tools.values():
            path = (native_root / item['source']).resolve()
            require(path.is_relative_to(native_root), 'Contained Source path')
            body = path.read_bytes()
            require(hashlib.sha256(body).hexdigest() == item['source_sha256'], f'Native Source changed: {item["name"]}')
            source_text = body.decode()
            require(f"#[Name('{item['name']}')]" in source_text and f"#[RequiredScope('{item['scope']}')]" in source_text, 'Actual native name/scope')
        for item in commercial['contract_sources']:
            path = (native_root / item['path']).resolve()
            require(path.is_relative_to(native_root), 'Contained helper Source path')
            require(hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], 'Commercial helper Source changed')
    return len(tools), len(skills)


class MetadataRegressions(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads((ROOT / 'plugin-contract.json').read_text())

    def reject(self, change):
        changed = copy.deepcopy(self.contract)
        change(changed)
        with self.assertRaises(ValueError):
            validate_contract(changed)

    def test_original_cannot_downgrade_to_read_grant(self):
        self.reject(lambda c: next(t for t in c['tools'] if t['name'] == 'get_crm_sequence_original').update(scope='automation:read'))

    def test_no_plural_legacy_sequence_scope(self):
        self.reject(lambda c: c['tools'][0].update(scope='automations:write'))

    def test_original_cannot_gain_effect(self):
        self.reject(lambda c: next(t for t in c['tools'] if t['name'] == 'recover_booking_service_receipt').update(category='WRITE'))

    def test_original_cannot_gain_confirmation(self):
        self.reject(lambda c: next(t for t in c['tools'] if t['name'] == 'get_crm_enrolment_original').update(optional_arguments=['confirmed']))

    def test_company_and_actor_not_forged(self):
        self.reject(lambda c: c['tools'][0]['optional_arguments'].append('company_id'))

    def test_control_cannot_fabricate_recovery(self):
        self.reject(lambda c: next(t for t in c['tools'] if t['kind'] == 'control').update(recovery_tool='get_crm_enrolment_original'))

    def test_task_time_not_workforce_scope(self):
        self.reject(lambda c: next(t for t in c['tools'] if t['name'] == 'get_running_task_timer').update(scope='time_entries:read'))

    def test_no_package_production_activation(self):
        self.reject(lambda c: c['server'].update(production_enabled_by_package=True))

    def test_no_fake_discovery_evidence(self):
        self.reject(lambda c: c['server'].update(live_discovery_verified=True))

    def test_protocol_compatibility_is_pinned_to_server_source(self):
        self.reject(
            lambda c: c['server']['protocol_compatibility']['modern'].append('2025-06-18'),
        )

    def test_every_tool_is_attributed_to_the_declared_mcp_server(self):
        self.reject(
            lambda c: c['tools'][0].update(server='unlisted-server'),
        )

    def test_duplicate_native_tool_rejected(self):
        self.reject(lambda c: c['tools'].__setitem__(0, copy.deepcopy(c['tools'][1])))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--native-root')
    args = parser.parse_args()
    count, skills = validate_package(args.native_root)
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(MetadataRegressions))
    require(result.wasSuccessful(), 'Package metadata regressions failed')
    print(f'Validated standalone package: {count} native Source tools, {skills} skills, {result.testsRun} metadata cases; no live calls or installation')

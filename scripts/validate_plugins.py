"""Validate local marketplace packages without contacting the billing API."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
marketplace = json.loads((root / '.claude-plugin/marketplace.json').read_text())
count = 0
for entry in marketplace['plugins']:
    package = (root / entry['source']).resolve()
    assert package.is_relative_to(root), 'Plugin source must be inside the repository'
    manifest = json.loads((package / '.claude-plugin/plugin.json').read_text())
    assert manifest['name'] == entry['name']
    assert manifest['version'] == entry['version']
    for skill in (package / 'skills').glob('*/SKILL.md'):
        text = skill.read_text()
        frontmatter = text.split('---', 2)
        assert len(frontmatter) == 3 and not frontmatter[0].strip(), skill
        assert f'name: {skill.parent.name}\n' in frontmatter[1], skill
        assert 'description: ' in frontmatter[1], skill
        count += 1
    for config in package.glob('.*.json'):
        json.loads(config.read_text())
assert count == 6, f'Expected all six existing skills, found {count}'
print(f'Validated {len(marketplace["plugins"])} plugins and {count} skills')

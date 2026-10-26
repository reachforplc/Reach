"""Sync the editable analytics module into Reach's standalone HTML."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
path = root / 'index.html' if (root / 'index.html').exists() else root / 'source/github-index.html'
html = path.read_text()
start = '// BEGIN ASSESSMENT ANALYTICS\n'
end = '// END ASSESSMENT ANALYTICS'
a = html.index(start) + len(start)
b = html.index(end, a)
path.write_text(html[:a] + (root / 'source/assessment-analytics.js').read_text() + '\n' + html[b:])
print('Embedded Assessment Analytics module')

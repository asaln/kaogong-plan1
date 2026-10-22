#!/usr/bin/env python3
"""Build single-file version of kaogong-planner by inlining all CSS and JS."""
import os

base = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(base, 'index.html'), 'r', encoding='utf-8') as f:
    html = f.read()
with open(os.path.join(base, 'css', 'style.css'), 'r', encoding='utf-8') as f:
    css = f.read()
with open(os.path.join(base, 'js', 'data.js'), 'r', encoding='utf-8') as f:
    data_js = f.read()
with open(os.path.join(base, 'js', 'sync.js'), 'r', encoding='utf-8') as f:
    sync_js = f.read()
with open(os.path.join(base, 'js', 'app.js'), 'r', encoding='utf-8') as f:
    app_js = f.read()

# Inline CSS
html = html.replace('<link rel="stylesheet" href="css/style.css">', f'<style>\n{css}\n</style>')

# Remove external script tags
for tag in ['<script src="js/data.js"></script>', '<script src="js/sync.js"></script>', '<script src="js/app.js"></script>']:
    if tag not in html:
        print(f"WARNING: {tag} not found in HTML")
    html = html.replace(tag, '')

# Verify removal
assert 'src="js/' not in html, "Script tags still present!"
assert 'href="css/' not in html, "CSS link still present!"

# Insert inline scripts before </body>
inline_js = f'\n<script>\n{data_js}\n</script>\n<script>\n{sync_js}\n</script>\n<script>\n{app_js}\n</script>\n'
html = html.replace('</body>', inline_js + '</body>')

out_path = os.path.join(base, 'kaogong-planner-single.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

print(f'OK: {len(html)/1024:.1f} KB written to {out_path}')

# Verify
assert 'kaogong_plan_v4' in html, "v4 NOT found!"
assert 'const DATA =' in html, "DATA NOT found!"
assert 'class SupabaseSync' in html, "SupabaseSync NOT found!"
assert 'function startEdit' in html, "startEdit NOT found!"
print("All checks passed!")

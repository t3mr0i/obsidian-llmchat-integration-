#!/usr/bin/env bash
# CAI scaffold visualizer — launches a local server with interactive graph visualization
set -euo pipefail

# Find scaffold directory (where ROUTER.md lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/ROUTER.md" ]]; then
    SCAFFOLD_DIR="$SCRIPT_DIR"
elif [[ -f "$SCRIPT_DIR/../ROUTER.md" ]]; then
    SCAFFOLD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
else
    echo "Error: Cannot find ROUTER.md. Run this script from the scaffold directory."
    exit 1
fi

PORT=4444

# Check if port is already in use
if lsof -i :$PORT >/dev/null 2>&1; then
    echo "Port $PORT is already in use. Kill the existing process or choose another port."
    exit 1
fi

echo ""
echo "  CAI scaffold visualizer"
echo "  ─────────────────────────"
echo "  Serving at http://localhost:$PORT"
echo "  Press Ctrl+C to stop"
echo ""

# Auto-open browser after a short delay
(sleep 1 && {
    if command -v open >/dev/null 2>&1; then
        open "http://localhost:$PORT"
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://localhost:$PORT"
    fi
}) &

# Run the embedded Python server
python3 - "$SCAFFOLD_DIR" "$PORT" << 'PYTHON_SERVER'
import sys
import os
import re
import json
import signal
import subprocess
import difflib
import datetime
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

SCAFFOLD_DIR = sys.argv[1]
PORT = int(sys.argv[2])

def detect_project_root(scaffold_dir):
    candidates = [
        scaffold_dir,
        os.path.dirname(scaffold_dir),
    ]
    markers = ('src', 'app', 'lib', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', '.git')
    for candidate in candidates:
        if any(os.path.exists(os.path.join(candidate, marker)) for marker in markers):
            return candidate
    return scaffold_dir

PROJECT_ROOT = detect_project_root(SCAFFOLD_DIR)

def signal_handler(sig, frame):
    print("\n  Shutting down...")
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)


def parse_frontmatter(filepath):
    """Parse YAML frontmatter from a markdown file without PyYAML."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return None, ''

    # Extract frontmatter between --- delimiters
    match = re.match(r'^---\s*\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return None, content

    fm_text = match.group(1)
    body = content[match.end():].strip()

    result = {
        'name': '',
        'description': '',
        'triggers': [],
        'edges': [],
        'last_updated': ''
    }

    # Parse the frontmatter line by line
    lines = fm_text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]

        # Simple key: value
        kv = re.match(r'^(\w[\w_]*):\s*(.+)$', line)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if key in ('name', 'description', 'last_updated'):
                result[key] = val.strip('"').strip("'")
            i += 1
            continue

        # triggers array
        if re.match(r'^triggers:\s*$', line):
            i += 1
            while i < len(lines) and re.match(r'^\s+-\s+', lines[i]):
                val = re.sub(r'^\s+-\s+', '', lines[i]).strip().strip('"').strip("'")
                result['triggers'].append(val)
                i += 1
            continue

        # edges array
        if re.match(r'^edges:\s*$', line):
            i += 1
            while i < len(lines):
                target_match = re.match(r'^\s+-\s+target:\s*(.+)$', lines[i])
                if target_match:
                    edge = {'target': target_match.group(1).strip(), 'condition': ''}
                    i += 1
                    # Look for condition on next line
                    if i < len(lines):
                        cond_match = re.match(r'^\s+condition:\s*(.+)$', lines[i])
                        if cond_match:
                            edge['condition'] = cond_match.group(1).strip()
                            i += 1
                    result['edges'].append(edge)
                else:
                    # Not an edge entry — done with edges block
                    break
            continue

        i += 1

    return result, body


def detect_status(body):
    """Analyze file body content to determine completion status."""
    if not body or not body.strip():
        return 'empty'

    # Remove frontmatter residue
    text = body.strip()

    # Strip headings to see if there's real content
    lines = text.split('\n')
    content_lines = []
    for line in lines:
        stripped = line.strip()
        # Skip empty lines, headings
        if not stripped or stripped.startswith('#'):
            continue
        content_lines.append(stripped)

    if not content_lines:
        return 'empty'

    full_content = '\n'.join(content_lines)

    # Check for annotation comments
    has_comments = bool(re.search(r'<!--.*?-->', full_content, re.DOTALL))
    has_placeholders = bool(re.search(r'\[TO DETERMINE\]|\[TO BE DETERMINED\]', full_content, re.IGNORECASE))

    # Check for real content (non-comment, non-placeholder lines)
    real_lines = []
    # Remove HTML comments
    cleaned = re.sub(r'<!--.*?-->', '', full_content, flags=re.DOTALL)
    for line in cleaned.split('\n'):
        stripped = line.strip()
        if stripped and not re.match(r'^\[TO (BE )?DETERMINE(D)?\]$', stripped, re.IGNORECASE):
            real_lines.append(stripped)

    has_real_content = len(real_lines) > 0

    if not has_real_content:
        # Only comments/placeholders/headings
        return 'empty'

    if has_comments or has_placeholders:
        return 'partial'

    return 'populated'


def parse_routing_table(filepath):
    """Parse the routing table from ROUTER.md."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return []

    routes = []
    in_table = False
    for line in content.split('\n'):
        stripped = line.strip()
        if stripped.startswith('| Task type'):
            in_table = True
            continue
        if in_table and stripped.startswith('|---'):
            continue
        if in_table and stripped.startswith('|'):
            cells = [c.strip() for c in stripped.split('|')]
            cells = [c for c in cells if c]
            if len(cells) >= 2:
                task_type = cells[0]
                load_target = cells[1]
                # Extract file path from backticks or markdown links
                path_match = re.search(r'`([^`]+)`', load_target)
                if path_match:
                    routes.append({
                        'task': task_type,
                        'target': path_match.group(1)
                    })
        elif in_table and not stripped.startswith('|'):
            break

    return routes


def looks_like_code_path(value):
    if not value or value.startswith('http'):
        return False
    if value.startswith('.cai/') or value.startswith('context/') or value.startswith('patterns/'):
        return False
    if '/' in value:
        return True
    return bool(re.search(r'\.(ts|tsx|js|jsx|py|go|rs|java|kt|swift|rb|php|c|cpp|cs|json|yml|yaml|toml|md)$', value))


def extract_code_references(body):
    refs = set()
    if not body:
        return refs

    for match in re.finditer(r'`([^`]+)`', body):
        candidate = match.group(1).strip()
        if looks_like_code_path(candidate):
            refs.add(candidate)

    for match in re.finditer(r'\b(?:src|app|lib|api|routes|services|components|pages|server|client|pkg|cmd)/[A-Za-z0-9_./-]+\b', body):
        refs.add(match.group(0))

    return refs


def scan_project_structure():
    nodes = []
    edges = []
    added = set()

    interesting_roots = [
        'src', 'app', 'lib', 'api', 'routes', 'services',
        'components', 'pages', 'server', 'client', 'pkg', 'cmd'
    ]

    for name in interesting_roots:
        abs_path = os.path.join(PROJECT_ROOT, name)
        if not os.path.exists(abs_path):
            continue
        rel_path = name
        add_code_node(nodes, added, rel_path, abs_path)

        if os.path.isdir(abs_path):
            walk_code_tree(nodes, edges, added, rel_path, abs_path, depth=0, max_depth=3)

    add_import_edges(nodes, edges)

    return nodes, edges


def walk_code_tree(nodes, edges, added, rel_path, abs_path, depth, max_depth):
    if depth >= max_depth or not os.path.isdir(abs_path):
        return

    try:
        children = sorted(os.listdir(abs_path))[:24]
    except Exception:
        children = []

    for child in children:
        if child.startswith('.') or child in ('node_modules', 'dist', 'build', '__pycache__', 'coverage'):
            continue
        child_abs = os.path.join(abs_path, child)
        child_rel = f'{rel_path}/{child}'
        if not (os.path.isdir(child_abs) or is_source_file(child_abs)):
            continue
        add_code_node(nodes, added, child_rel, child_abs)
        edges.append({'source': rel_path, 'target': child_rel, 'condition': 'contains'})
        if os.path.isdir(child_abs):
            walk_code_tree(nodes, edges, added, child_rel, child_abs, depth + 1, max_depth)


def add_code_node(nodes, added, rel_path, abs_path):
    if rel_path in added:
        return
    added.add(rel_path)
    nodes.append({
        'id': rel_path,
        'name': os.path.basename(rel_path),
        'filename': rel_path,
        'description': describe_code_path(rel_path, abs_path),
        'type': 'code',
        'triggers': [],
        'last_updated': '',
        'edge_count': 0,
        'status': 'populated',
        'content': preview_code_path(abs_path)
    })


def is_source_file(path):
    return os.path.isfile(path) and bool(re.search(r'\.(ts|tsx|js|jsx|py|go|rs|java|kt|swift|rb|php|c|cpp|cs)$', path))


def describe_code_path(rel_path, abs_path):
    if os.path.isdir(abs_path):
        return f'Code area: {rel_path}'
    return f'Code file: {rel_path}'


def preview_code_path(abs_path):
    if os.path.isdir(abs_path):
        try:
            children = sorted(os.listdir(abs_path))[:12]
            return '\n'.join(children)
        except Exception:
            return ''

    try:
        with open(abs_path, 'r', encoding='utf-8') as f:
            return ''.join(f.readlines()[:40])
    except Exception:
        return ''


def add_import_edges(nodes, edges):
    known_ids = {node['id'] for node in nodes}
    code_files = [node for node in nodes if node['type'] == 'code' and re.search(r'\.(ts|tsx|js|jsx|py|go|rs)$', node['id'])]

    for node in code_files[:80]:
        abs_path = os.path.join(PROJECT_ROOT, node['id'])
        imports = extract_import_targets(abs_path)
        base_dir = os.path.dirname(node['id'])
        for target in imports:
            resolved = resolve_import_target(base_dir, target, known_ids)
            if resolved and resolved != node['id']:
                edges.append({
                    'source': node['id'],
                    'target': resolved,
                    'condition': 'imports'
                })


def extract_import_targets(abs_path):
    try:
        with open(abs_path, 'r', encoding='utf-8') as f:
            text = f.read()
    except Exception:
        return []

    targets = []
    patterns = [
        r'import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]',
        r'import\s+[\'"]([^\'"]+)[\'"]',
        r'require\([\'"]([^\'"]+)[\'"]\)',
        r'from\s+[\'"]([^\'"]+)[\'"]\s+import\s+',
    ]
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            target = match.group(1).strip()
            if target.startswith('.'):
                targets.append(target)
    return targets


def resolve_import_target(base_dir, target, known_ids):
    normalized = os.path.normpath(os.path.join(base_dir, target)).replace('\\', '/')
    candidates = [
        normalized,
        normalized + '.ts',
        normalized + '.tsx',
        normalized + '.js',
        normalized + '.jsx',
        normalized + '.py',
        normalized + '.go',
        normalized + '.rs',
        normalized + '/index.ts',
        normalized + '/index.tsx',
        normalized + '/index.js',
        normalized + '/index.jsx',
        normalized + '/__init__.py',
        normalized + '/mod.rs',
    ]
    for candidate in candidates:
        if candidate in known_ids:
            return candidate
    parts = normalized.split('/')
    while len(parts) > 1:
        parts.pop()
        parent = '/'.join(parts)
        if parent in known_ids:
            return parent
    return None


def scan_scaffold():
    """Scan all .md files in the scaffold and return graph data."""
    nodes = []
    edges = []
    node_ids = set()

    # Collect all relevant .md files
    md_files = []

    # Root level scaffold files
    for name in ['ROUTER.md', 'AGENTS.md', 'SETUP.md', 'SYNC.md']:
        path = os.path.join(SCAFFOLD_DIR, name)
        if os.path.isfile(path):
            md_files.append((name, path))

    # Context files
    ctx_dir = os.path.join(SCAFFOLD_DIR, 'context')
    if os.path.isdir(ctx_dir):
        for f in sorted(os.listdir(ctx_dir)):
            if f.endswith('.md'):
                md_files.append((f'context/{f}', os.path.join(ctx_dir, f)))

    # Pattern files
    pat_dir = os.path.join(SCAFFOLD_DIR, 'patterns')
    if os.path.isdir(pat_dir):
        for f in sorted(os.listdir(pat_dir)):
            if f.endswith('.md'):
                md_files.append((f'patterns/{f}', os.path.join(pat_dir, f)))

    # Parse all files
    file_data = {}
    for rel_path, abs_path in md_files:
        fm, body = parse_frontmatter(abs_path)
        if fm is None:
            fm = {'name': rel_path, 'description': '', 'triggers': [], 'edges': [], 'last_updated': ''}

        # Determine type
        if '/' not in rel_path:
            ftype = 'root'
        elif rel_path.startswith('context/'):
            ftype = 'context'
        elif rel_path.startswith('patterns/'):
            ftype = 'pattern'
        else:
            ftype = 'other'

        status = detect_status(body)

        file_data[rel_path] = {
            'id': rel_path,
            'name': fm.get('name', '') or rel_path,
            'filename': rel_path,
            'description': fm.get('description', ''),
            'type': ftype,
            'triggers': fm.get('triggers', []),
            'edges_raw': fm.get('edges', []),
            'last_updated': fm.get('last_updated', ''),
            'status': status,
            'content': body
        }
        node_ids.add(rel_path)

    # Parse routing table from ROUTER.md
    router_path = os.path.join(SCAFFOLD_DIR, 'ROUTER.md')
    routing_table = parse_routing_table(router_path)

    # Build nodes and edges
    for rel_path, data in file_data.items():
        nodes.append({
            'id': data['id'],
            'name': data['name'],
            'filename': data['filename'],
            'description': data['description'],
            'type': data['type'],
            'triggers': data['triggers'],
            'last_updated': data['last_updated'],
            'edge_count': len(data['edges_raw']),
            'status': data['status'],
            'content': data['content']
        })

        for edge in data['edges_raw']:
            target = edge.get('target', '')
            if target in node_ids:
                edges.append({
                    'source': rel_path,
                    'target': target,
                    'condition': edge.get('condition', '')
                })

    # Add code structure nodes from the actual project
    code_nodes, code_edges = scan_project_structure()
    for node in code_nodes:
        if node['id'] not in node_ids:
            nodes.append(node)
            node_ids.add(node['id'])
    edges.extend(code_edges)

    command_nodes, command_edges = scan_command_structure()
    for node in command_nodes:
        if node['id'] not in node_ids:
            nodes.append(node)
            node_ids.add(node['id'])
    edges.extend(command_edges)

    data_nodes, data_edges = scan_data_structures()
    for node in data_nodes:
        if node['id'] not in node_ids:
            nodes.append(node)
            node_ids.add(node['id'])
    edges.extend(data_edges)

    symbol_nodes, symbol_edges = scan_symbol_structure()
    for node in symbol_nodes:
        if node['id'] not in node_ids:
            nodes.append(node)
            node_ids.add(node['id'])
    edges.extend(symbol_edges)

    # Add inferred scaffold -> code edges from referenced paths
    for rel_path, data in file_data.items():
        refs = extract_code_references(data['content'])
        for ref in refs:
            ref_abs = os.path.join(PROJECT_ROOT, ref)
            if not os.path.exists(ref_abs):
                continue
            if ref not in node_ids:
                add_code_node(nodes, node_ids, ref, ref_abs)
            edges.append({
                'source': rel_path,
                'target': ref,
                'condition': 'references code'
            })

    edges = dedupe_edges(edges)
    enrich_graph(nodes, edges)
    return {
        'nodes': nodes,
        'edges': edges,
        'routing_table': routing_table,
        'hot_paths': build_hot_paths(nodes, edges)
    }


def dedupe_edges(edges):
    seen = set()
    result = []
    for edge in edges:
        key = (edge['source'], edge['target'], edge.get('condition', ''))
        if key in seen:
            continue
        seen.add(key)
        result.append(edge)
    return result


def enrich_graph(nodes, edges):
    drift = load_drift_overlay()
    git_stats = load_git_overlay(nodes)
    drift_issue_count = drift.get('by_file', {})
    drift_codes = drift.get('codes_by_file', {})

    for node in nodes:
        filename = node.get('filename', '')
        path_key = node.get('id', '')
        node['layer'] = node.get('type', 'other')
        node['driftCount'] = drift_issue_count.get(filename, 0) or drift_issue_count.get(path_key, 0) or 0
        node['driftCodes'] = drift_codes.get(filename, []) or drift_codes.get(path_key, []) or []
        node['git'] = git_stats.get(path_key, {'lastCommitDays': None, 'commitCount': 0})

    for edge in edges:
        edge['confidence'] = edge_confidence(edge.get('condition', ''))
        edge['sourceType'] = edge_source_type(edge.get('condition', ''))
    add_edge_diff(edges, nodes)


def edge_confidence(condition):
    c = (condition or '').lower()
    if c in ('imports', 'contains', 'registers command', 'defines'):
        return 'high'
    if c in ('executes', 'produces', 'uses data structure', 'starts scan', 'starts drift check', 'starts doctor', 'starts autofix', 'starts sync'):
        return 'medium'
    if c.startswith('references') or c in ('checks docs vs code', 'maps folders', 'collects manifests', 'collects entry points', 'builds service graph', 'reads frontmatter', 'extracts claims', 'scores drift', 'reruns drift', 'builds ai brief', 'inspects'):
        return 'medium'
    return 'low'


def edge_source_type(condition):
    c = (condition or '').lower()
    if c in ('imports', 'contains', 'registers command', 'defines'):
        return 'static'
    if c.startswith('references'):
        return 'documentation'
    return 'inferred'


def load_drift_overlay():
    cli_path = os.path.join(PROJECT_ROOT, 'dist', 'cli.js')
    if not os.path.isfile(cli_path):
        return {'by_file': {}, 'codes_by_file': {}}
    try:
        result = subprocess.run(
            ['node', cli_path, 'check', '--json'],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=20
        )
        if result.returncode not in (0, 1):
            return {'by_file': {}, 'codes_by_file': {}}
        payload = json.loads(result.stdout or '{}')
    except Exception:
        return {'by_file': {}, 'codes_by_file': {}}

    by_file = {}
    codes_by_file = {}
    for issue in payload.get('issues', []):
        file = issue.get('file')
        if not file:
            continue
        by_file[file] = by_file.get(file, 0) + 1
        codes_by_file.setdefault(file, []).append(issue.get('code', 'ISSUE'))
    return {'by_file': by_file, 'codes_by_file': codes_by_file}


def load_git_overlay(nodes):
    if not os.path.isdir(os.path.join(PROJECT_ROOT, '.git')):
        return {}
    stats = {}
    for node in nodes:
        node_id = node.get('id')
        if not node_id or node.get('type') not in ('root', 'context', 'pattern', 'code'):
            continue
        target_path = os.path.join(PROJECT_ROOT, node_id)
        if not os.path.exists(target_path):
            target_path = os.path.join(SCAFFOLD_DIR, node_id)
        if not os.path.exists(target_path):
            continue
        rel = os.path.relpath(target_path, PROJECT_ROOT)
        try:
            last = subprocess.run(
                ['git', 'log', '-1', '--format=%ct', '--', rel],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                timeout=5
            )
            count = subprocess.run(
                ['git', 'rev-list', '--count', 'HEAD', '--', rel],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                timeout=5
            )
            timeline = subprocess.run(
                ['git', 'log', '-3', '--pretty=format:%h|%ct|%s', '--', rel],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                timeout=5
            )
            ts = int((last.stdout or '0').strip() or '0')
            commit_count = int((count.stdout or '0').strip() or '0')
            days = None
            if ts > 0:
                now = int(time.time())
                days = max(0, (now - ts) // 86400)
            recent = []
            for line in (timeline.stdout or '').splitlines():
                if not line:
                    continue
                parts = line.split('|', 2)
                if len(parts) != 3:
                    continue
                h, ts_line, msg = parts
                try:
                    ts_val = int(ts_line)
                    date = datetime.datetime.utcfromtimestamp(ts_val).strftime('%Y-%m-%d %H:%M')
                except Exception:
                    date = ts_line
                recent.append({'hash': h, 'date': date, 'message': msg})
            stats[node_id] = {'lastCommitDays': days, 'commitCount': commit_count, 'recent': recent}
        except Exception:
            stats[node_id] = {'lastCommitDays': None, 'commitCount': 0}
    return stats


def build_hot_paths(nodes, edges):
    degree = {}
    for node in nodes:
        degree[node['id']] = 0
    for edge in edges:
        degree[edge['source']] = degree.get(edge['source'], 0) + 1
        degree[edge['target']] = degree.get(edge['target'], 0) + 1
    ranked = sorted(
        [{'id': node['id'], 'filename': node['filename'], 'degree': degree.get(node['id'], 0), 'type': node['type']} for node in nodes],
        key=lambda item: item['degree'],
        reverse=True
    )
    return ranked[:10]


def scan_command_structure():
    cli_path = os.path.join(PROJECT_ROOT, 'src', 'cli.ts')
    if not os.path.isfile(cli_path):
        return [], []

    try:
        with open(cli_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return [], []

    nodes = []
    edges = []
    command_map = {
        'check': ['src/drift/index.ts', 'src/reporter.ts'],
        'init': ['src/scanner/index.ts'],
        'setup': ['src/bootstrap.ts'],
        'bootstrap': ['src/bootstrap.ts'],
        'doctor': ['src/doctor.ts'],
        'update': ['src/update.ts'],
        'fix': ['src/fix.ts', 'src/drift/index.ts'],
        'sync': ['src/sync/index.ts', 'src/sync/brief-builder.ts'],
        'pattern': ['src/pattern/index.ts'],
        'watch': ['src/watch.ts'],
        'sync-configs': ['src/drift/checkers/tool-configs.ts'],
        'visualize': ['visualize.sh'],
        'menu': ['sync.sh'],
        'help': ['src/cli.ts'],
        'commands': ['src/cli.ts'],
    }

    descriptions = {}
    for match in re.finditer(r'\.command\("([^"]+)(?:\s+\[[^"]+\]|\s+<[^"]+>)?"\)\s*\n\s*\.description\("([^"]+)"\)', content):
        descriptions[match.group(1)] = match.group(2)

    for command_name, targets in command_map.items():
        node_id = f'command:{command_name}'
        nodes.append({
            'id': node_id,
            'name': command_name,
            'filename': f'cai {command_name}',
            'description': descriptions.get(command_name, f'CLI command: cai {command_name}'),
            'type': 'command',
            'triggers': [command_name],
            'last_updated': '',
            'edge_count': 0,
            'status': 'populated',
            'content': f'Command\n\ncai {command_name}\n\n{descriptions.get(command_name, "")}'.strip()
        })
        edges.append({'source': 'src/cli.ts', 'target': node_id, 'condition': 'registers command'})
        for target in targets:
            target_abs = os.path.join(PROJECT_ROOT, target)
            if os.path.exists(target_abs):
                edges.append({'source': node_id, 'target': target, 'condition': 'executes'})

    return nodes, edges


def scan_data_structures():
    types_path = os.path.join(PROJECT_ROOT, 'src', 'types.ts')
    if not os.path.isfile(types_path):
        return [], []

    try:
        with open(types_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return [], []

    nodes = []
    edges = []
    names = []

    for match in re.finditer(r'export\s+interface\s+([A-Z][A-Za-z0-9_]+)\s*\{', content):
        name = match.group(1)
        block = extract_block(content, match.start())
        names.append(name)
        nodes.append({
            'id': f'data:{name}',
            'name': name,
            'filename': f'type {name}',
            'description': 'Shared data structure',
            'type': 'data',
            'triggers': [name],
            'last_updated': '',
            'edge_count': 0,
            'status': 'populated',
            'content': block.strip()
        })
        edges.append({'source': 'src/types.ts', 'target': f'data:{name}', 'condition': 'defines'})

    for match in re.finditer(r'export\s+type\s+([A-Z][A-Za-z0-9_]+)\s*=', content):
        name = match.group(1)
        line = content[match.start():content.find('\n', match.start()) if content.find('\n', match.start()) != -1 else len(content)]
        if name in names:
            continue
        names.append(name)
        nodes.append({
            'id': f'data:{name}',
            'name': name,
            'filename': f'type {name}',
            'description': 'Shared type alias',
            'type': 'data',
            'triggers': [name],
            'last_updated': '',
            'edge_count': 0,
            'status': 'populated',
            'content': line.strip()
        })
        edges.append({'source': 'src/types.ts', 'target': f'data:{name}', 'condition': 'defines'})

    code_files = collect_project_code_files()
    for rel_path in code_files:
        abs_path = os.path.join(PROJECT_ROOT, rel_path)
        try:
            with open(abs_path, 'r', encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue
        for name in names:
            if re.search(r'\b' + re.escape(name) + r'\b', text) and rel_path != 'src/types.ts':
                edges.append({'source': rel_path, 'target': f'data:{name}', 'condition': 'uses data structure'})

    add_domain_flow_edges(edges)
    return nodes, edges


def scan_symbol_structure():
    nodes = []
    edges = []
    data_names = collect_type_names()
    symbol_index = {}
    for rel_path in collect_project_code_files():
        abs_path = os.path.join(PROJECT_ROOT, rel_path)
        try:
            with open(abs_path, 'r', encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue

        seen = set()
        patterns = [
            r'export\s+async\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(',
            r'export\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(',
            r'export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=',
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                name = match.group(1)
                if name in seen:
                    continue
                seen.add(name)
                symbol_id = f'symbol:{rel_path}:{name}'
                snippet = extract_symbol_snippet(text, match.start())
                nodes.append({
                    'id': symbol_id,
                    'name': name,
                    'filename': f'{name}()',
                    'description': f'Symbol in {rel_path}',
                    'type': 'symbol',
                    'triggers': [name],
                    'last_updated': '',
                    'edge_count': 0,
                    'status': 'populated',
                    'content': snippet
                })
                edges.append({'source': rel_path, 'target': symbol_id, 'condition': 'defines symbol'})
                symbol_index[name] = (symbol_id, rel_path, snippet)
                for data_name in data_names:
                    if re.search(r'\b' + re.escape(data_name) + r'\b', snippet):
                        edges.append({'source': symbol_id, 'target': f'data:{data_name}', 'condition': 'uses data structure'})

    link_symbol_calls(symbol_index, edges)
    return nodes, edges


def link_symbol_calls(symbol_index, edges):
    names = list(symbol_index.keys())
    for name, (symbol_id, rel_path, snippet) in symbol_index.items():
        if not snippet:
            continue
        for target_name in names:
            if target_name == name:
                continue
            target_id = symbol_index[target_name][0]
            if re.search(r'\b' + re.escape(target_name) + r'\b', snippet):
                edges.append({'source': symbol_id, 'target': target_id, 'condition': 'calls'})


def collect_type_names():
    types_path = os.path.join(PROJECT_ROOT, 'src', 'types.ts')
    if not os.path.isfile(types_path):
        return []
    try:
        with open(types_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception:
        return []
    names = re.findall(r'export\s+(?:interface|type)\s+([A-Z][A-Za-z0-9_]+)', content)
    return sorted(set(names))


def extract_symbol_snippet(text, start_index):
    lines = text[start_index:].splitlines()
    return '\n'.join(lines[:14]).strip()


def extract_block(content, start_index):
    end = content.find('{', start_index)
    if end == -1:
        return ''
    depth = 0
    i = end
    while i < len(content):
        if content[i] == '{':
            depth += 1
        elif content[i] == '}':
            depth -= 1
            if depth == 0:
                return content[start_index:i + 1]
        i += 1
    return content[start_index:]


def collect_project_code_files():
    files = []
    for root, dirs, filenames in os.walk(os.path.join(PROJECT_ROOT, 'src')):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', 'dist', 'build')]
        rel_root = os.path.relpath(root, PROJECT_ROOT).replace('\\', '/')
        for filename in filenames:
            if re.search(r'\.(ts|tsx|js|jsx|py|go|rs)$', filename):
                files.append(f'{rel_root}/{filename}')
    return files


def add_domain_flow_edges(edges):
    flows = [
        ('command:init', 'src/scanner/index.ts', 'starts scan'),
        ('src/scanner/index.ts', 'src/scanner/manifest.ts', 'collects manifests'),
        ('src/scanner/index.ts', 'src/scanner/entry-points.ts', 'collects entry points'),
        ('src/scanner/index.ts', 'src/scanner/service-graph.ts', 'builds service graph'),
        ('src/scanner/index.ts', 'src/scanner/folder-tree.ts', 'maps folders'),
        ('src/scanner/index.ts', 'src/scanner/reconciliation.ts', 'checks docs vs code'),
        ('src/scanner/index.ts', 'data:ScannerBrief', 'produces'),
        ('command:check', 'src/drift/index.ts', 'starts drift check'),
        ('src/drift/index.ts', 'src/drift/claims.ts', 'extracts claims'),
        ('src/drift/index.ts', 'src/drift/frontmatter.ts', 'reads frontmatter'),
        ('src/drift/index.ts', 'src/drift/scoring.ts', 'scores drift'),
        ('src/drift/index.ts', 'data:DriftReport', 'produces'),
        ('command:doctor', 'src/doctor.ts', 'starts doctor'),
        ('src/doctor.ts', 'data:ProjectModel', 'inspects'),
        ('command:fix', 'src/fix.ts', 'starts autofix'),
        ('src/fix.ts', 'src/drift/index.ts', 'reruns drift'),
        ('command:sync', 'src/sync/index.ts', 'starts sync'),
        ('src/sync/index.ts', 'src/sync/brief-builder.ts', 'builds AI brief'),
    ]
    for source, target, condition in flows:
        edges.append({'source': source, 'target': target, 'condition': condition})


def add_edge_diff(edges, nodes):
    node_map = {node['id']: node for node in nodes}
    for edge in edges:
        if edge.get('confidence') != 'high':
            continue
        sid = edge['source']
        tid = edge['target']
        src = node_map.get(sid)
        tgt = node_map.get(tid)
        if not src or not tgt:
            continue
        if src.get('type') in ('root', 'context', 'pattern') and tgt.get('type') == 'code':
            src_text = src.get('content', '').splitlines()
            tgt_text = tgt.get('content', '').splitlines()
            diff = list(difflib.unified_diff(src_text[:20], tgt_text[:20], fromfile=src['filename'], tofile=tgt['filename'], n=3))
            if diff:
                edge['diff'] = '\n'.join(diff[:15])


HTML_PAGE = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CAI scaffold visualizer</title>
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #0d1117;
    color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
  }

  /* ─── Header ─── */
  #header {
    position: fixed;
    top: 0; left: 0;
    z-index: 100;
    padding: 16px 24px;
    pointer-events: none;
  }
  #header h1 {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: #ffffff;
  }
  #header h1 span { color: #1944F1; }
  #header p {
    font-size: 11px;
    color: #8b949e;
    margin-top: 2px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    font-weight: 500;
  }

  /* ─── Progress Bar ─── */
  #progress-bar-container {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 150;
    height: 3px;
    background: #21262d;
  }
  #progress-bar-fill {
    height: 100%;
    border-radius: 0 3px 3px 0;
    background: linear-gradient(90deg, #2ea043, #56d364);
    transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
  }
  #progress-bar-fill.pulsing::after {
    content: '';
    position: absolute;
    top: 0; right: 0; bottom: 0;
    width: 80px;
    background: linear-gradient(90deg, transparent, rgba(86, 211, 100, 0.4), transparent);
    animation: progress-pulse 2s ease-in-out infinite;
  }
  @keyframes progress-pulse {
    0%, 100% { opacity: 0; }
    50% { opacity: 1; }
  }
  #progress-label {
    position: fixed;
    top: 7px; left: 50%;
    transform: translateX(-50%);
    z-index: 151;
    font-size: 10px;
    color: #8b949e;
    letter-spacing: 0.5px;
    pointer-events: none;
  }

  /* ─── Navigation Simulator ─── */
  #nav-simulator {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 120;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  #nav-input {
    width: 320px;
    padding: 8px 14px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    color: #e6edf3;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  #nav-input:focus {
    border-color: #1944F1;
    box-shadow: 0 0 0 3px rgba(25, 68, 241, 0.15);
  }
  #nav-input::placeholder { color: #484f58; }
  #nav-presets {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 720px;
  }
  .nav-preset {
    padding: 6px 10px;
    background: rgba(22, 27, 34, 0.92);
    border: 1px solid #30363d;
    border-radius: 999px;
    color: #8b949e;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
  }
  .nav-preset:hover {
    color: #e6edf3;
    border-color: #4d7aff;
    background: #161b22;
  }
  #graph-tools {
    position: fixed;
    top: 96px;
    right: 24px;
    z-index: 120;
    width: 280px;
    background: rgba(22, 27, 34, 0.94);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.3);
  }
  .tool-title {
    font-size: 10px;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    margin-bottom: 8px;
    font-weight: 700;
  }
  #search-input {
    width: 100%;
    padding: 8px 10px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    color: #e6edf3;
    font-size: 12px;
    margin-bottom: 12px;
  }
  #layer-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .layer-chip {
    padding: 5px 8px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 999px;
    color: #8b949e;
    font-size: 11px;
    cursor: pointer;
  }
  .layer-chip.active {
    color: #e6edf3;
    border-color: #4d7aff;
    background: rgba(25, 68, 241, 0.16);
  }
  .tool-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    font-size: 12px;
    color: #c9d1d9;
  }
  .toggle {
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: #30363d;
    position: relative;
    cursor: pointer;
  }
  .toggle::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #e6edf3;
    transition: transform 0.2s;
  }
  .toggle.active {
    background: #1944F1;
  }
  .toggle.active::after {
    transform: translateX(16px);
  }
  #timeline-panel {
    position: fixed;
    top: 360px;
    right: 24px;
    z-index: 120;
    width: 280px;
    background: rgba(14, 17, 21, 0.92);
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.45);
    display: none;
  }
  #timeline-panel.visible { display: block; }
  .timeline-item {
    font-size: 11px;
    color: #c9d1d9;
    border-bottom: 1px solid #21262d;
    padding: 6px 0;
  }
  .timeline-item:last-child { border-bottom: none; }
  .timeline-item .timeline-date {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    color: #58a6ff;
    display: block;
  }
  .timeline-item .timeline-msg {
    margin-top: 4px;
  }
  #hot-paths {
    margin-top: 10px;
  }
  .hot-path {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid #21262d;
    font-size: 11px;
  }
  .hot-path:last-child {
    border-bottom: none;
  }
  .hot-path-name {
    color: #c9d1d9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hot-path-score {
    color: #8b949e;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  }

  /* ─── Layout Toggle ─── */
  #layout-toggle {
    position: fixed;
    top: 16px; right: 24px;
    z-index: 120;
    display: flex;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    overflow: hidden;
  }
  .layout-btn {
    padding: 7px 14px;
    font-size: 11px;
    font-weight: 500;
    color: #8b949e;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    font-family: inherit;
    letter-spacing: 0.3px;
  }
  .layout-btn.active {
    background: #30363d;
    color: #e6edf3;
  }
  .layout-btn.flow-active {
    background: #1944F1;
    color: #ffffff;
  }
  .layout-btn:hover:not(.active) { color: #c9d1d9; }

  /* ─── Legend ─── */
  #legend {
    position: fixed;
    bottom: 40px; left: 24px;
    z-index: 100;
    display: flex;
    gap: 16px;
    font-size: 11px;
    color: #8b949e;
    pointer-events: none;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .legend-ring {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid;
    background: transparent;
  }

  /* ─── Stats Bar ─── */
  #stats-bar {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    z-index: 100;
    height: 28px;
    background: #161b22;
    border-top: 1px solid #21262d;
    display: flex;
    align-items: center;
    padding: 0 24px;
    gap: 24px;
    font-size: 11px;
    color: #484f58;
  }
  .stat-item { display: flex; align-items: center; gap: 5px; }
  .stat-value { color: #8b949e; font-weight: 500; }

  /* ─── SVG ─── */
  svg { width: 100%; height: 100%; display: block; }

  /* ─── Canvas overlay for particles ─── */
  #particle-canvas {
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
    z-index: 5;
  }

  /* ─── Side Panel ─── */
  #side-panel {
    position: fixed;
    top: 0; right: 0;
    width: 380px;
    height: 100vh;
    background: #161b22;
    border-left: 1px solid #30363d;
    z-index: 200;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow-y: auto;
    padding: 0;
  }
  #side-panel.open { transform: translateX(0); }

  .panel-header {
    padding: 20px 20px 14px;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .panel-close {
    background: none;
    border: none;
    color: #8b949e;
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    line-height: 1;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .panel-close:hover { background: #30363d; color: #e6edf3; }

  .panel-title {
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
    word-break: break-word;
  }
  .panel-filename {
    font-size: 11px;
    color: #8b949e;
    margin-top: 3px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  }
  .panel-badges {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .panel-type-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 3px 8px;
    border-radius: 12px;
  }
  .panel-status-badge {
    display: inline-block;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 3px 8px;
    border-radius: 12px;
  }

  /* ─── Panel Tabs ─── */
  .panel-tabs {
    display: flex;
    border-bottom: 1px solid #21262d;
  }
  .panel-tab {
    flex: 1;
    padding: 10px;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    color: #8b949e;
    background: none;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    border-bottom: 2px solid transparent;
    font-family: inherit;
  }
  .panel-tab.active {
    color: #e6edf3;
    border-bottom-color: #1944F1;
  }
  .panel-tab:hover:not(.active) { color: #c9d1d9; }

  .panel-tab-content { display: none; }
  .panel-tab-content.active { display: block; }

  .panel-section {
    padding: 14px 20px;
    border-bottom: 1px solid #21262d;
  }
  .panel-section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #8b949e;
    margin-bottom: 8px;
  }
  .panel-description {
    font-size: 13px;
    line-height: 1.6;
    color: #c9d1d9;
  }

  .panel-edge {
    padding: 8px 12px;
    background: #0d1117;
    border-radius: 8px;
    margin-bottom: 6px;
    border: 1px solid #21262d;
  }
  .panel-edge-target {
    font-size: 12px;
    font-weight: 500;
    color: #58a6ff;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  }
  .panel-edge-condition {
    font-size: 11px;
    color: #8b949e;
    margin-top: 3px;
    line-height: 1.4;
  }

  .panel-trigger {
    display: inline-block;
    font-size: 11px;
    padding: 3px 10px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 12px;
    margin: 2px 3px 2px 0;
    color: #c9d1d9;
  }
  .panel-action-btn {
    display: inline-block;
    margin-top: 10px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid #30363d;
    background: #0d1117;
    color: #e6edf3;
    font-size: 12px;
    cursor: pointer;
  }
  .panel-action-btn:hover {
    border-color: #4d7aff;
  }

  /* ─── Content Preview ─── */
  .content-preview {
    padding: 16px 20px;
    font-size: 13px;
    line-height: 1.7;
    color: #c9d1d9;
  }
  .content-preview .cp-heading {
    font-weight: 700;
    color: #e6edf3;
    margin: 14px 0 6px;
  }
  .content-preview .cp-h1 { font-size: 18px; }
  .content-preview .cp-h2 { font-size: 15px; }
  .content-preview .cp-h3 { font-size: 13px; }
  .content-preview .cp-list-item {
    padding-left: 16px;
    position: relative;
  }
  .content-preview .cp-list-item::before {
    content: '\2022';
    position: absolute;
    left: 4px;
    color: #484f58;
  }
  .content-preview .cp-code-block {
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 6px;
    padding: 10px 14px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px;
    margin: 8px 0;
    white-space: pre-wrap;
    overflow-x: auto;
    color: #e6edf3;
  }
  .content-preview .cp-comment {
    color: #484f58;
    font-style: italic;
    font-size: 12px;
  }
  .content-preview .cp-paragraph {
    margin: 6px 0;
  }
  .content-preview .cp-table-row {
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 11px;
    color: #8b949e;
    padding: 2px 0;
  }
  .content-preview code {
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 4px;
    padding: 1px 5px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px;
    color: #e6edf3;
  }
  .content-preview a {
    color: #58a6ff;
    text-decoration: none;
  }
  .content-preview a:hover { text-decoration: underline; }
  .content-preview .cp-directory-list {
    display: grid;
    gap: 6px;
  }
  .content-preview .cp-directory-item {
    padding: 8px 10px;
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 6px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 12px;
    color: #c9d1d9;
  }

  /* ─── Navigation Narration ─── */
  #nav-narration {
    position: fixed;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 110;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 10px;
    padding: 14px 20px;
    max-width: 500px;
    min-width: 300px;
    font-size: 13px;
    color: #c9d1d9;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    display: none;
    transition: opacity 0.3s;
  }
  #nav-narration.visible { display: block; }
  .nav-step {
    padding: 4px 0;
    opacity: 0.4;
    transition: opacity 0.3s;
  }
  .nav-step.active { opacity: 1; color: #e6edf3; }
  .nav-step.done { opacity: 0.7; color: #2ea043; }
  .nav-step-arrow { color: #484f58; margin-right: 6px; }
  .nav-no-match { color: #f85149; }

  /* ─── Flow Details ─── */
  #flow-details {
    position: fixed;
    left: 24px;
    top: 120px;
    z-index: 115;
    width: 320px;
    max-height: calc(100vh - 220px);
    overflow-y: auto;
    background: rgba(22, 27, 34, 0.94);
    border: 1px solid #30363d;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
    padding: 14px 16px;
    display: none;
  }
  #flow-details.visible { display: block; }
  .flow-title {
    font-size: 13px;
    font-weight: 700;
    color: #ffffff;
  }
  .flow-subtitle {
    margin-top: 4px;
    font-size: 11px;
    color: #8b949e;
  }
  .flow-section {
    margin-top: 14px;
  }
  .flow-section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: #8b949e;
    margin-bottom: 8px;
  }
  .flow-pill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .flow-pill {
    font-size: 11px;
    color: #c9d1d9;
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 999px;
    padding: 4px 8px;
  }
  .flow-file {
    display: block;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 11px;
    color: #58a6ff;
    padding: 6px 0;
    border-bottom: 1px solid #21262d;
    word-break: break-word;
  }
  .flow-file:last-child {
    border-bottom: none;
  }
  .flow-empty {
    font-size: 12px;
    color: #6e7681;
  }

  /* ─── Empty State ─── */
  #empty-state {
    display: none;
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    z-index: 50;
  }
  #empty-state h2 { font-size: 20px; color: #8b949e; font-weight: 500; margin-bottom: 8px; }
  #empty-state p { font-size: 14px; color: #484f58; }

  /* ─── Tooltip ─── */
  #tooltip {
    position: fixed;
    pointer-events: none;
    z-index: 300;
    background: #1c2128;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    color: #c9d1d9;
    opacity: 0;
    transition: opacity 0.15s;
    max-width: 280px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  #tooltip.visible { opacity: 1; }
  .tooltip-label {
    font-size: 10px;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .tooltip-path {
    margin-top: 4px;
    font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
    font-size: 11px;
    color: #e6edf3;
    word-break: break-word;
  }

  /* ─── Scrollbar ─── */
  #side-panel::-webkit-scrollbar { width: 6px; }
  #side-panel::-webkit-scrollbar-track { background: transparent; }
  #side-panel::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
  #side-panel::-webkit-scrollbar-thumb:hover { background: #484f58; }
</style>
</head>
<body>

<div id="progress-bar-container">
  <div id="progress-bar-fill"></div>
</div>
<div id="progress-label"></div>

<div id="header">
  <h1><span>CAI</span></h1>
  <p>scaffold visualizer</p>
</div>

<div id="nav-simulator">
  <input type="text" id="nav-input" placeholder="Simulate: what task are you doing?" spellcheck="false" />
  <div id="nav-presets">
    <button class="nav-preset" data-query="run drift check">drift check</button>
    <button class="nav-preset" data-query="auto-fix safe issues">auto-fix</button>
    <button class="nav-preset" data-query="sync broken scaffold files">sync scaffold</button>
    <button class="nav-preset" data-query="bootstrap a project">bootstrap</button>
    <button class="nav-preset" data-query="scan architecture and service graph">scan architecture</button>
    <button class="nav-preset" data-query="inspect data structures and project model">data model</button>
  </div>
</div>

<div id="graph-tools">
  <div class="tool-title">Search</div>
  <input id="search-input" type="text" placeholder="Find file, type, command, model..." spellcheck="false" />
  <div class="tool-title">Layers</div>
  <div id="layer-filters">
    <button class="layer-chip active" data-layer="root">Root</button>
    <button class="layer-chip active" data-layer="context">Context</button>
    <button class="layer-chip active" data-layer="pattern">Pattern</button>
    <button class="layer-chip active" data-layer="command">Command</button>
    <button class="layer-chip active" data-layer="data">Data</button>
    <button class="layer-chip active" data-layer="symbol">Symbol</button>
    <button class="layer-chip active" data-layer="code">Code</button>
  </div>
  <div class="tool-row"><span>Drift overlay</span><button class="toggle" id="drift-toggle" type="button"></button></div>
  <div class="tool-row"><span>Git activity</span><button class="toggle" id="git-toggle" type="button"></button></div>
  <div class="tool-row"><span>Confidence labels</span><button class="toggle" id="confidence-toggle" type="button"></button></div>
  <div class="tool-row"><span>Impact mode</span><button class="toggle" id="impact-toggle" type="button"></button></div>
  <div class="tool-title">Hot Paths</div>
  <div id="hot-paths"></div>
</div>

<div id="timeline-panel"></div>

<div id="layout-toggle">
  <button class="layout-btn active" data-layout="force">Force</button>
  <button class="layout-btn" data-layout="clustered">Clustered</button>
  <button class="layout-btn" id="flow-focus-btn">Flow Focus</button>
</div>

<div id="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#f0a500"></div> Root</div>
  <div class="legend-item"><div class="legend-dot" style="background:#1944F1"></div> Context</div>
  <div class="legend-item"><div class="legend-dot" style="background:#2ea043"></div> Patterns</div>
  <div class="legend-item"><div class="legend-dot" style="background:#d29922"></div> Commands</div>
  <div class="legend-item"><div class="legend-dot" style="background:#db61a2"></div> Data</div>
  <div class="legend-item"><div class="legend-dot" style="background:#58a6ff"></div> Symbols</div>
  <div class="legend-item"><div class="legend-dot" style="background:#8b949e"></div> Code</div>
  <div class="legend-item" style="margin-left:12px"><div class="legend-ring" style="border-color:#2ea043"></div> Populated</div>
  <div class="legend-item"><div class="legend-ring" style="border-color:#f0a500"></div> Partial</div>
  <div class="legend-item"><div class="legend-ring" style="border-color:#f85149"></div> Empty</div>
</div>

<div id="stats-bar">
  <div class="stat-item">Nodes <span class="stat-value" id="stat-nodes">0</span></div>
  <div class="stat-item">Edges <span class="stat-value" id="stat-edges">0</span></div>
  <div class="stat-item">Completion <span class="stat-value" id="stat-completion">0%</span></div>
  <div class="stat-item">Undetermined <span class="stat-value" id="stat-undetermined">0</span></div>
</div>

<div id="empty-state">
  <h2>No edges found</h2>
  <p>Run setup first to populate the scaffold</p>
</div>

<div id="tooltip"></div>

<div id="nav-narration"></div>
<div id="flow-details"></div>

<div id="side-panel">
  <div class="panel-header">
    <div>
      <div class="panel-title" id="panel-title"></div>
      <div class="panel-filename" id="panel-filename"></div>
      <div class="panel-badges">
        <div class="panel-type-badge" id="panel-badge"></div>
        <div class="panel-status-badge" id="panel-status-badge"></div>
      </div>
    </div>
    <button class="panel-close" id="panel-close">&times;</button>
  </div>
  <div class="panel-tabs">
    <button class="panel-tab active" data-tab="info">Info</button>
    <button class="panel-tab" data-tab="content">Content</button>
  </div>
  <div id="panel-tab-info" class="panel-tab-content active"></div>
  <div id="panel-tab-content" class="panel-tab-content"></div>
</div>

<canvas id="particle-canvas"></canvas>
<svg id="graph"></svg>

<script>
const COLORS = {
  root: '#f0a500',
  context: '#1944F1',
  pattern: '#2ea043',
  command: '#d29922',
  data: '#db61a2',
  symbol: '#58a6ff',
  code: '#8b949e',
  other: '#8b949e'
};

const GLOW_COLORS = {
  root: 'rgba(240, 165, 0, 0.6)',
  context: 'rgba(25, 68, 241, 0.5)',
  pattern: 'rgba(46, 160, 67, 0.5)',
  command: 'rgba(210, 153, 34, 0.42)',
  data: 'rgba(219, 97, 162, 0.35)',
  symbol: 'rgba(88, 166, 255, 0.35)',
  code: 'rgba(139, 148, 158, 0.35)',
  other: 'rgba(139, 148, 158, 0.3)'
};

const STATUS_COLORS = {
  populated: '#2ea043',
  partial: '#f0a500',
  empty: '#f85149'
};

const SIZE = {
  'ROUTER.md': 28,
  'AGENTS.md': 20,
  'SETUP.md': 18,
  'SYNC.md': 18,
  context: 16,
  pattern: 12,
  command: 14,
  data: 11,
  symbol: 9,
  code: 10,
  other: 10
};

function nodeSize(d) {
  if (SIZE[d.filename]) return SIZE[d.filename];
  return SIZE[d.type] || SIZE.other;
}

function nodeColor(d) { return COLORS[d.type] || COLORS.other; }
function glowColor(d) { return GLOW_COLORS[d.type] || GLOW_COLORS.other; }
function statusColor(d) { return STATUS_COLORS[d.status] || STATUS_COLORS.empty; }

// ─── Global state ───
let graphData = null;
let simulation = null;
let currentLayout = 'force';
let nodeG = null;
let link = null;
let linkHover = null;
let particleCtx = null;
let particles = [];
let svgTransform = null;
let gGroup = null;
let navAnimating = false;
let flowFocusEnabled = false;
let activeFlowNodeIds = [];
let activeLayers = new Set(['root', 'context', 'pattern', 'command', 'data', 'symbol', 'code']);
let searchQuery = '';
let driftOverlayEnabled = false;
let gitOverlayEnabled = false;
let confidenceOverlayEnabled = false;
let impactModeEnabled = false;
let activeImpactNodeIds = [];
let activeImpactOriginId = null;
let lastPanelNodeId = null;
const FLOW_PRESETS = [
  {
    name: 'drift-check',
    keywords: ['drift', 'check', 'wrong', 'outdated'],
    nodes: ['ROUTER.md', 'command:check', 'src/drift/index.ts', 'src/drift/claims.ts', 'src/drift/frontmatter.ts', 'src/drift/scoring.ts', 'data:DriftReport'],
    messages: [
      'Starting from ROUTER.md to choose the drift workflow...',
      'Running cai check...',
      'Collecting scaffold files and project context...',
      'Extracting claims from markdown...',
      'Reading frontmatter and edges...',
      'Scoring issues into a drift report...',
      'Producing DriftReport output...'
    ]
  },
  {
    name: 'auto-fix',
    keywords: ['fix', 'autofix', 'auto-fix', 'repair', 'safe'],
    nodes: ['ROUTER.md', 'command:fix', 'src/fix.ts', 'src/drift/index.ts', 'src/drift/checkers/tool-configs.ts', 'data:DriftReport'],
    messages: [
      'Starting from ROUTER.md to choose the fix workflow...',
      'Running cai fix...',
      'Applying low-risk fixes...',
      'Re-running drift detection...',
      'Syncing low-risk tool config drift when possible...',
      'Returning the updated drift state...'
    ]
  },
  {
    name: 'sync-scaffold',
    keywords: ['sync', 'scaffold', 'prompt', 'broken', 'update docs'],
    nodes: ['ROUTER.md', 'command:sync', 'src/sync/index.ts', 'src/drift/index.ts', 'src/sync/brief-builder.ts', 'data:SyncTarget'],
    messages: [
      'Starting from ROUTER.md to choose the sync workflow...',
      'Running cai sync...',
      'Collecting current drift issues...',
      'Checking what is still broken...',
      'Building targeted AI repair briefs...',
      'Producing per-file sync targets...'
    ]
  },
  {
    name: 'bootstrap',
    keywords: ['bootstrap', 'setup', 'init project', 'first time'],
    nodes: ['ROUTER.md', 'command:bootstrap', 'src/bootstrap.ts', 'command:setup', 'SETUP.md'],
    messages: [
      'Starting from ROUTER.md to choose first-time setup...',
      'Running cai bootstrap...',
      'Installing the local scaffold...',
      'Running cai setup...',
      'Handing off to setup guidance...'
    ]
  },
  {
    name: 'scan-architecture',
    keywords: ['architecture', 'service graph', 'scan', 'entry points', 'understand codebase'],
    nodes: ['ROUTER.md', 'command:init', 'src/scanner/index.ts', 'src/scanner/entry-points.ts', 'src/scanner/service-graph.ts', 'src/scanner/folder-tree.ts', 'data:ScannerBrief', 'data:ServiceGraph'],
    messages: [
      'Starting from ROUTER.md to understand the project...',
      'Running cai init...',
      'Scanning the codebase...',
      'Finding entry points...',
      'Building the service graph...',
      'Mapping the folder structure...',
      'Producing the scanner brief...',
      'Showing the service graph model...'
    ]
  },
  {
    name: 'data-model',
    keywords: ['data', 'model', 'types', 'schema', 'project model', 'structure'],
    nodes: ['src/types.ts', 'data:CaiConfig', 'data:ProjectModel', 'data:ScannerBrief', 'data:DriftReport', 'data:ServiceGraph'],
    messages: [
      'Opening the shared type layer...',
      'Inspecting config shape...',
      'Inspecting project topology model...',
      'Inspecting scanner output shape...',
      'Inspecting drift result shape...',
      'Inspecting service graph shape...'
    ]
  }
];

fetch('/api/graph')
  .then(r => r.json())
  .then(data => {
    graphData = data;
    updateStats(data);
    updateProgressBar(data);
    render(data);
    initParticles(data);
    initNavSimulator(data);
    initGraphTools(data);
  });

function updateStats(data) {
  const { nodes, edges } = data;
  document.getElementById('stat-nodes').textContent = nodes.length;
  document.getElementById('stat-edges').textContent = edges.length;

  const contentFiles = nodes.filter(n => n.type !== 'root' || n.filename === 'ROUTER.md');
  const populated = nodes.filter(n => n.status === 'populated').length;
  const pct = nodes.length > 0 ? Math.round((populated / nodes.length) * 100) : 0;
  document.getElementById('stat-completion').textContent = pct + '%';

  const undetermined = nodes.filter(n => n.status === 'partial' || n.status === 'empty').length;
  document.getElementById('stat-undetermined').textContent = undetermined;
}

function updateProgressBar(data) {
  const { nodes } = data;
  const populated = nodes.filter(n => n.status === 'populated').length;
  const pct = nodes.length > 0 ? Math.round((populated / nodes.length) * 100) : 0;

  const fill = document.getElementById('progress-bar-fill');
  fill.style.width = pct + '%';
  if (pct < 100) {
    fill.classList.add('pulsing');
  } else {
    fill.classList.remove('pulsing');
  }
  document.getElementById('progress-label').textContent = 'Scaffold completion: ' + pct + '%';
}

function initGraphTools(data) {
  const search = document.getElementById('search-input');
  if (search) {
    search.addEventListener('input', () => {
      searchQuery = search.value.trim().toLowerCase();
      applyGraphFilters();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        focusFirstSearchMatch();
      }
    });
  }

  document.querySelectorAll('.layer-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const layer = chip.dataset.layer;
      if (!layer) return;
      if (activeLayers.has(layer)) {
        activeLayers.delete(layer);
        chip.classList.remove('active');
      } else {
        activeLayers.add(layer);
        chip.classList.add('active');
      }
      applyGraphFilters();
    });
  });

  bindToggle('drift-toggle', (value) => {
    driftOverlayEnabled = value;
    if (value && lastPanelNodeId) {
      const node = graphData && graphData.nodes.find(n => n.id === lastPanelNodeId);
      if (node) renderTimeline(node);
    }
    if (!value) clearTimeline();
    applyGraphFilters();
  });
  bindToggle('git-toggle', (value) => {
    gitOverlayEnabled = value;
    applyGraphFilters();
  });
  bindToggle('confidence-toggle', (value) => {
    confidenceOverlayEnabled = value;
    applyGraphFilters();
  });
  bindToggle('impact-toggle', (value) => {
    impactModeEnabled = value;
    if (!impactModeEnabled) {
      activeImpactNodeIds = [];
      activeImpactOriginId = null;
      if (activeFlowNodeIds.length) {
        renderFlowDetails(
          activeFlowNodeIds.map(id => ({ nodeId: id, message: id })),
          { query: 'Current simulated flow', nodes: graphData ? graphData.nodes : [] }
        );
      } else {
        clearFlowDetails();
      }
    }
    applyGraphFilters();
  });

  renderHotPaths(data.hot_paths || []);
}

function bindToggle(id, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', () => {
    const next = !el.classList.contains('active');
    el.classList.toggle('active', next);
    onChange(next);
  });
}

function renderHotPaths(items) {
  const root = document.getElementById('hot-paths');
  if (!root) return;
  root.innerHTML = items.slice(0, 6).map(item =>
    '<div class="hot-path" data-node-id="' + escapeJs(item.id) + '"><span class="hot-path-name">' + escapeHtml(item.filename) +
    '</span><span class="hot-path-score">' + escapeHtml(String(item.degree)) + '</span></div>'
  ).join('');
  root.querySelectorAll('.hot-path').forEach(el => {
    el.addEventListener('click', () => {
      const nodeId = el.dataset.nodeId;
      if (nodeId) focusNodeById(nodeId);
    });
  });
}

function renderTimeline(node) {
  const panel = document.getElementById('timeline-panel');
  if (!panel || !driftOverlayEnabled || !node || !node.git || !node.git.recent || !node.git.recent.length) {
    clearTimeline();
    return;
  }
  const items = node.git.recent.map(item =>
    '<div class="timeline-item"><span class="timeline-date">' + escapeHtml(item.date) + ' ' + escapeHtml(item.hash) + '</span>' +
    '<div class="timeline-msg">' + escapeHtml(item.message) + '</div></div>'
  ).join('');
  panel.innerHTML = '<div class="tool-title">Recent commits</div>' + items;
  panel.classList.add('visible');
}

function clearTimeline() {
  const panel = document.getElementById('timeline-panel');
  if (panel) {
    panel.classList.remove('visible');
    panel.innerHTML = '';
  }
}

function focusFirstSearchMatch() {
  if (!graphData || !searchQuery) return;
  const match = graphData.nodes.find(node => {
    const haystack = [node.id, node.filename, node.name || '', node.description || ''].join(' ').toLowerCase();
    return haystack.includes(searchQuery);
  });
  if (match) focusNodeById(match.id);
}

function focusNodeById(nodeId) {
  if (!graphData || !nodeG || !simulation) return;
  const node = graphData.nodes.find(item => item.id === nodeId);
  if (!node) return;

  showPanel(node, graphData.edges);
  if (impactModeEnabled) {
    const impact = computeImpactSet(node.id, graphData.edges, graphData.nodes);
    activeImpactOriginId = node.id;
    activeImpactNodeIds = impact;
    renderImpactDetails(node, impact, graphData.nodes, graphData.edges);
  }
  applyGraphFilters();

  nodeG.filter(n => n.id === nodeId).each(function(d) {
    d3.select(this).select('.node-circle')
      .transition().duration(220).attr('r', nodeSize(d) * 1.45)
      .transition().duration(260).attr('r', nodeSize(d) * 1.1);
    d3.select(this).select('.node-glow')
      .transition().duration(220).attr('r', nodeSize(d) + 10).attr('opacity', 0.85)
      .transition().duration(260).attr('r', nodeSize(d) + 4).attr('opacity', 0.55);
  });

  if (gGroup && node.x != null && node.y != null) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = svgTransform ? svgTransform.k : 0.9;
    svgTransform = d3.zoomIdentity.translate(width / 2 - node.x * scale, height / 2 - node.y * scale).scale(scale);
    gGroup.transition().duration(450).attr('transform', svgTransform);
  }
  if (driftOverlayEnabled) renderTimeline(node);
}

function render(data) {
  const { nodes, edges } = data;

  if (edges.length === 0) {
    document.getElementById('empty-state').style.display = 'block';
    if (nodes.length === 0) return;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;

  const svg = d3.select('#graph')
    .attr('width', width)
    .attr('height', height);

  // ─── Defs ───
  const defs = svg.append('defs');

  // Glow filter for edges
  const glowFilter = defs.append('filter')
    .attr('id', 'glow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');
  glowFilter.append('feGaussianBlur')
    .attr('stdDeviation', '3')
    .attr('result', 'blur');
  glowFilter.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur', 'SourceGraphic'])
    .enter().append('feMergeNode')
    .attr('in', d => d);

  // Node glow filter
  const nodeGlowF = defs.append('filter')
    .attr('id', 'node-glow')
    .attr('x', '-100%').attr('y', '-100%')
    .attr('width', '300%').attr('height', '300%');
  nodeGlowF.append('feGaussianBlur')
    .attr('stdDeviation', '6')
    .attr('result', 'blur');
  nodeGlowF.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur', 'SourceGraphic'])
    .enter().append('feMergeNode')
    .attr('in', d => d);

  // Arrow markers
  defs.append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#30363d');

  defs.append('marker')
    .attr('id', 'arrow-highlight')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#58a6ff');

  defs.append('marker')
    .attr('id', 'arrow-nav')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 20).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#f0a500');

  const g = svg.append('g');
  gGroup = g;

  // Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.2, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
      svgTransform = event.transform;
    });
  svg.call(zoom);

  svgTransform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.9);
  svg.call(zoom.transform, svgTransform);

  // Adjacency map for hover
  const adjacency = new Map();
  nodes.forEach(n => adjacency.set(n.id, new Set()));
  edges.forEach(e => {
    const sid = typeof e.source === 'object' ? e.source.id : e.source;
    const tid = typeof e.target === 'object' ? e.target.id : e.target;
    adjacency.get(sid)?.add(tid);
    adjacency.get(tid)?.add(sid);
  });

  // ─── Force simulation ───
  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(140).strength(0.4))
    .force('charge', d3.forceManyBody().strength(-600).distanceMax(500))
    .force('center', d3.forceCenter(0, 0))
    .force('collision', d3.forceCollide().radius(d => nodeSize(d) + 20))
    .force('x', d3.forceX(0).strength(0.03))
    .force('y', d3.forceY(0).strength(0.03))
    .alphaDecay(0.015)
    .velocityDecay(0.4);

  // ─── Draw edges ───
  const linkGroup = g.append('g').attr('class', 'links');
  link = linkGroup.selectAll('line')
    .data(edges)
    .enter().append('line')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.6)
    .attr('marker-end', 'url(#arrow)');

  linkHover = linkGroup.selectAll('.link-hover')
    .data(edges)
    .enter().append('line')
    .attr('class', 'link-hover')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 12)
    .on('mouseenter', (event, d) => {
      if (d.condition) {
        const tooltip = document.getElementById('tooltip');
        tooltip.innerHTML = '<div class="tooltip-label">Edge condition</div>' + escapeHtml(d.condition);
        tooltip.classList.add('visible');
        tooltip.style.left = event.clientX + 12 + 'px';
        tooltip.style.top = event.clientY - 10 + 'px';
      }
    })
    .on('mousemove', (event) => {
      const tooltip = document.getElementById('tooltip');
      tooltip.style.left = event.clientX + 12 + 'px';
      tooltip.style.top = event.clientY - 10 + 'px';
    })
    .on('mouseleave', () => {
      document.getElementById('tooltip').classList.remove('visible');
    })
    .on('click', (event, d) => {
      event.stopPropagation();
      showEdgePanel(d);
    });

  // ─── Draw nodes ───
  const nodeGroup = g.append('g').attr('class', 'nodes');

  nodeG = nodeGroup.selectAll('g')
    .data(nodes)
    .enter().append('g')
    .attr('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.1).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      })
    );

  // Outer glow
  nodeG.append('circle')
    .attr('class', 'node-glow')
    .attr('r', d => nodeSize(d) + 4)
    .attr('fill', d => glowColor(d))
    .attr('filter', 'url(#node-glow)')
    .attr('opacity', 0.4);

  // Status ring
  nodeG.append('circle')
    .attr('class', 'node-status-ring')
    .attr('r', d => nodeSize(d) + 3)
    .attr('fill', 'none')
    .attr('stroke', d => statusColor(d))
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.7)
    .attr('stroke-dasharray', d => d.status === 'empty' ? '3,3' : d.status === 'partial' ? '6,3' : 'none');

  // Main circle
  nodeG.append('circle')
    .attr('class', 'node-circle')
    .attr('r', d => nodeSize(d))
    .attr('fill', d => nodeColor(d))
    .attr('stroke', d => nodeColor(d))
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.8)
    .attr('fill-opacity', 0.85);

  // Inner highlight
  nodeG.append('circle')
    .attr('class', 'node-inner')
    .attr('r', d => nodeSize(d) * 0.4)
    .attr('fill', 'rgba(255,255,255,0.15)');

  // Labels
  nodeG.append('text')
    .attr('class', 'node-label')
    .attr('dy', d => nodeSize(d) + 16)
    .attr('text-anchor', 'middle')
    .attr('fill', '#c9d1d9')
    .attr('font-size', d => d.type === 'root' ? '12px' : d.type === 'code' ? '10px' : '11px')
    .attr('font-weight', d => d.type === 'root' ? '600' : '400')
    .style('text-shadow', '0 1px 3px rgba(0,0,0,0.6)')
    .text(d => {
      const parts = d.filename.split('/');
      const last = parts[parts.length - 1].replace('.md', '');
      if (d.type === 'symbol') return d.name || last;
      if (d.type === 'code' && parts.length > 1) return parts.slice(-2).join('/');
      return last;
    });

  // Folder prefix
  nodeG.filter(d => d.type !== 'root' && d.type !== 'code' && d.type !== 'symbol')
    .append('text')
    .attr('class', 'node-folder')
    .attr('dy', d => nodeSize(d) + 28)
    .attr('text-anchor', 'middle')
    .attr('fill', '#484f58')
    .attr('font-size', '9px')
    .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)')
    .text(d => {
      const parts = d.filename.split('/');
      return parts.length > 1 ? parts[0] + '/' : '';
    });

  // ─── Hover interactions ───
  nodeG.on('mouseenter', (event, d) => {
    if (navAnimating) return;
    const connected = adjacency.get(d.id) || new Set();

    const tooltip = document.getElementById('tooltip');
    tooltip.innerHTML =
      '<div class="tooltip-label">' + escapeHtml(d.type) + '</div>' +
      '<div class="tooltip-path">' + escapeHtml(d.filename) + '</div>';
    tooltip.classList.add('visible');
    tooltip.style.left = event.clientX + 12 + 'px';
    tooltip.style.top = event.clientY - 10 + 'px';

    nodeG.transition().duration(200)
      .attr('opacity', n => (n.id === d.id || connected.has(n.id)) ? 1 : 0.15);

    link.transition().duration(200)
      .attr('stroke', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        return (sid === d.id || tid === d.id) ? '#58a6ff' : '#30363d';
      })
      .attr('stroke-opacity', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        return (sid === d.id || tid === d.id) ? 1 : 0.1;
      })
      .attr('stroke-width', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        return (sid === d.id || tid === d.id) ? 2.5 : 1.5;
      })
      .attr('marker-end', e => {
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        return (sid === d.id || tid === d.id) ? 'url(#arrow-highlight)' : 'url(#arrow)';
      });

    d3.select(event.currentTarget).select('.node-circle')
      .transition().duration(200).attr('r', nodeSize(d) * 1.2);
    d3.select(event.currentTarget).select('.node-glow')
      .transition().duration(200).attr('r', nodeSize(d) * 1.2 + 6).attr('opacity', 0.7);
    d3.select(event.currentTarget).select('.node-status-ring')
      .transition().duration(200).attr('r', nodeSize(d) * 1.2 + 4);
    d3.select(event.currentTarget).select('.node-inner')
      .transition().duration(200).attr('r', nodeSize(d) * 0.5);
  });

  nodeG.on('mousemove', (event) => {
    const tooltip = document.getElementById('tooltip');
    tooltip.style.left = event.clientX + 12 + 'px';
    tooltip.style.top = event.clientY - 10 + 'px';
  });

  nodeG.on('mouseleave', (event, d) => {
    if (navAnimating) return;
    document.getElementById('tooltip').classList.remove('visible');
    if (flowFocusEnabled && activeFlowNodeIds.length > 0) {
      applyFlowFocus(activeFlowNodeIds);
    } else {
      clearFlowFocus();
    }

    d3.select(event.currentTarget).select('.node-circle')
      .transition().duration(300).attr('r', nodeSize(d));
    d3.select(event.currentTarget).select('.node-glow')
      .transition().duration(300).attr('r', nodeSize(d) + 4).attr('opacity', 0.4);
    d3.select(event.currentTarget).select('.node-status-ring')
      .transition().duration(300).attr('r', nodeSize(d) + 3);
    d3.select(event.currentTarget).select('.node-inner')
      .transition().duration(300).attr('r', nodeSize(d) * 0.4);
  });

  // Click to show side panel
  nodeG.on('click', (event, d) => {
    event.stopPropagation();
    showPanel(d, edges);
    if (impactModeEnabled) {
      const impact = computeImpactSet(d.id, data.edges);
      activeImpactOriginId = d.id;
      activeImpactNodeIds = impact;
      renderImpactDetails(d, impact, data.nodes, data.edges);
      applyGraphFilters();
    }
    const preset = selectFlowPresetForNode(d.id);
    if (preset && !navAnimating) {
      const query = preset.keywords[0] || preset.name;
      const input = document.getElementById('nav-input');
      if (input) input.value = query;
      runNavSimulation(query, data);
    }
  });

  svg.on('click', () => {
    document.getElementById('side-panel').classList.remove('open');
    if (impactModeEnabled) {
      activeImpactNodeIds = [];
      activeImpactOriginId = null;
      if (!activeFlowNodeIds.length) clearFlowDetails();
      applyGraphFilters();
    }
  });

  document.getElementById('panel-close').addEventListener('click', () => {
    document.getElementById('side-panel').classList.remove('open');
  });

  // ─── Panel tabs ───
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ─── Layout toggle ───
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.id === 'flow-focus-btn') return;
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchLayout(btn.dataset.layout, nodes, width, height);
    });
  });

  const flowFocusBtn = document.getElementById('flow-focus-btn');
  if (flowFocusBtn) {
    flowFocusBtn.addEventListener('click', () => {
      flowFocusEnabled = !flowFocusEnabled;
      flowFocusBtn.classList.toggle('flow-active', flowFocusEnabled);
      if (flowFocusEnabled && activeFlowNodeIds.length > 0) {
        applyFlowFocus(activeFlowNodeIds);
      } else {
        clearFlowFocus();
      }
    });
  }

  // Simulation tick
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    linkHover
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  applyGraphFilters();
}

// ─── Layout switching ───
function switchLayout(layout, nodes, width, height) {
  currentLayout = layout;

  if (layout === 'clustered') {
    // Disable forces, position by cluster
    simulation.force('center', null);
    simulation.force('charge', d3.forceManyBody().strength(-200).distanceMax(300));
    simulation.force('x', d3.forceX(d => {
      if (d.type === 'root') return 0;
      if (d.type === 'context') return -250;
      if (d.type === 'pattern') return 250;
      if (d.type === 'command') return -80;
      if (d.type === 'data') return 420;
      if (d.type === 'symbol') return 250;
      if (d.type === 'code') return 120;
      return 0;
    }).strength(0.3));
    simulation.force('y', d3.forceY(d => {
      if (d.type === 'root') return 0;
      if (d.type === 'command') return -160;
      if (d.type === 'data') return 140;
      if (d.type === 'symbol') return -20;
      return 0;
    }).strength(0.1));
  } else {
    simulation.force('center', d3.forceCenter(0, 0));
    simulation.force('charge', d3.forceManyBody().strength(-600).distanceMax(500));
    simulation.force('x', d3.forceX(0).strength(0.03));
    simulation.force('y', d3.forceY(0).strength(0.03));
  }

  simulation.alpha(0.6).restart();
}

function applyGraphFilters() {
  if (!nodeG || !link) return;
  if (!driftOverlayEnabled) clearTimeline();
  const visibleNodeIds = new Set();

  nodeG.each(function(d) {
    const matchesLayer = activeLayers.has(d.type);
    const haystack = [d.id, d.filename, d.name || '', d.description || ''].join(' ').toLowerCase();
    const matchesSearch = !searchQuery || haystack.includes(searchQuery);
    if (matchesLayer && matchesSearch) {
      visibleNodeIds.add(d.id);
    }
  });

  nodeG.transition().duration(180)
    .attr('opacity', d => {
      if (impactModeEnabled && activeImpactNodeIds.length > 0) {
        return activeImpactNodeIds.includes(d.id) && visibleNodeIds.has(d.id) ? 1 : 0.05;
      }
      if (flowFocusEnabled && activeFlowNodeIds.length > 0) {
        return activeFlowNodeIds.includes(d.id) && visibleNodeIds.has(d.id) ? 1 : 0.06;
      }
      return visibleNodeIds.has(d.id) ? 1 : 0.08;
    });

  nodeG.select('.node-circle')
    .attr('stroke', d => {
      if (driftOverlayEnabled && d.driftCount > 0) return '#f85149';
      if (gitOverlayEnabled && d.git && d.git.lastCommitDays !== null && d.git.lastCommitDays <= 7) return '#56d364';
      return nodeColor(d);
    })
    .attr('stroke-width', d => {
      if (driftOverlayEnabled && d.driftCount > 0) return 3;
      if (gitOverlayEnabled && d.git && d.git.lastCommitDays !== null && d.git.lastCommitDays <= 7) return 3;
      return 2;
    });

  nodeG.select('.node-glow')
    .attr('opacity', d => {
      if (driftOverlayEnabled && d.driftCount > 0) return 0.75;
      if (gitOverlayEnabled && d.git && d.git.lastCommitDays !== null && d.git.lastCommitDays <= 7) return 0.7;
      return 0.4;
    })
    .attr('fill', d => {
      if (driftOverlayEnabled && d.driftCount > 0) return 'rgba(248,81,73,0.5)';
      if (gitOverlayEnabled && d.git && d.git.lastCommitDays !== null && d.git.lastCommitDays <= 7) return 'rgba(86,211,100,0.45)';
      return glowColor(d);
    });

  nodeG.select('.node-status-ring')
    .attr('stroke', d => {
      if (driftOverlayEnabled && d.driftCount > 0) return '#f85149';
      return statusColor(d);
    });

  link.transition().duration(180)
    .attr('stroke', e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      if (!(visibleNodeIds.has(sid) && visibleNodeIds.has(tid))) return '#30363d';
      if (impactModeEnabled && activeImpactNodeIds.length > 0) {
        return activeImpactNodeIds.includes(sid) && activeImpactNodeIds.includes(tid) ? '#58a6ff' : '#30363d';
      }
      if (confidenceOverlayEnabled) {
        return e.confidence === 'high' ? '#56d364' : e.confidence === 'medium' ? '#d29922' : '#8b949e';
      }
      if (flowFocusEnabled && activeFlowNodeIds.length > 0 && activeFlowNodeIds.includes(sid) && activeFlowNodeIds.includes(tid)) return '#f0a500';
      return '#30363d';
    })
    .attr('stroke-opacity', e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      if (!(visibleNodeIds.has(sid) && visibleNodeIds.has(tid))) return 0.03;
      if (impactModeEnabled && activeImpactNodeIds.length > 0) {
        return activeImpactNodeIds.includes(sid) && activeImpactNodeIds.includes(tid) ? 0.95 : 0.04;
      }
      if (flowFocusEnabled && activeFlowNodeIds.length > 0) {
        return activeFlowNodeIds.includes(sid) && activeFlowNodeIds.includes(tid) ? 0.95 : 0.05;
      }
      return confidenceOverlayEnabled ? (e.confidence === 'high' ? 0.9 : e.confidence === 'medium' ? 0.6 : 0.35) : 0.6;
    })
    .attr('stroke-dasharray', e => {
      if (!confidenceOverlayEnabled) return 'none';
      return e.confidence === 'low' ? '3,4' : e.confidence === 'medium' ? '7,4' : 'none';
    });
}

// ─── Side Panel ───
function showPanel(d, allEdges) {
  const panel = document.getElementById('side-panel');
  document.getElementById('panel-title').textContent = d.name || d.filename;
  document.getElementById('panel-filename').textContent = d.filename;

  // Type badge
  const badgeColors = {
    root: { bg: 'rgba(240,165,0,0.15)', color: '#f0a500' },
    context: { bg: 'rgba(25,68,241,0.15)', color: '#4d7aff' },
    pattern: { bg: 'rgba(46,160,67,0.15)', color: '#2ea043' },
    command: { bg: 'rgba(210,153,34,0.15)', color: '#d29922' },
    data: { bg: 'rgba(219,97,162,0.15)', color: '#db61a2' },
    symbol: { bg: 'rgba(88,166,255,0.15)', color: '#58a6ff' },
    code: { bg: 'rgba(139,148,158,0.15)', color: '#8b949e' }
  };
  const bc = badgeColors[d.type] || { bg: 'rgba(139,148,158,0.15)', color: '#8b949e' };
  const badgeEl = document.getElementById('panel-badge');
  badgeEl.textContent = d.type;
  badgeEl.style.background = bc.bg;
  badgeEl.style.color = bc.color;

  // Status badge
  const statusBadgeEl = document.getElementById('panel-status-badge');
  const sc = STATUS_COLORS[d.status] || '#8b949e';
  statusBadgeEl.textContent = d.status;
  statusBadgeEl.style.background = sc + '22';
  statusBadgeEl.style.color = sc;

  // ─── Info tab ───
  let html = '';

  if (d.description) {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Description</div>';
    html += '<div class="panel-description">' + escapeHtml(d.description) + '</div>';
    if (d.filename) {
      html += '<button class="panel-action-btn" onclick="openNodeFile(\'' + escapeJs(d.filename) + '\')">Open file</button>';
    }
    html += '</div>';
  }

  if (d.driftCount || (d.git && (d.git.lastCommitDays !== null || d.git.commitCount))) {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Diagnostics</div>';
    if (d.driftCount) {
      html += '<div class="panel-description">Drift issues: ' + escapeHtml(String(d.driftCount)) + '</div>';
    }
    if (d.driftCodes && d.driftCodes.length) {
      html += '<div style="margin-top:8px">';
      d.driftCodes.slice(0, 6).forEach(code => {
        html += '<span class="panel-trigger">' + escapeHtml(code) + '</span>';
      });
      html += '</div>';
    }
    if (d.git) {
      if (d.git.lastCommitDays !== null) {
        html += '<div class="panel-description" style="margin-top:8px">Last commit: ' + escapeHtml(String(d.git.lastCommitDays)) + ' days ago</div>';
      }
      html += '<div class="panel-description">Commits touching file: ' + escapeHtml(String(d.git.commitCount || 0)) + '</div>';
    }
    html += '</div>';
  }

  const outEdges = allEdges.filter(e => {
    const sid = typeof e.source === 'object' ? e.source.id : e.source;
    return sid === d.id;
  });
  const inEdges = allEdges.filter(e => {
    const tid = typeof e.target === 'object' ? e.target.id : e.target;
    return tid === d.id;
  });

  if (outEdges.length > 0) {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Outgoing edges (' + outEdges.length + ')</div>';
    outEdges.forEach(e => {
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      html += '<div class="panel-edge">';
      html += '<div class="panel-edge-target">' + escapeHtml(tid) + '</div>';
      if (e.condition) html += '<div class="panel-edge-condition">' + escapeHtml(e.condition) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (inEdges.length > 0) {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Incoming edges (' + inEdges.length + ')</div>';
    inEdges.forEach(e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      html += '<div class="panel-edge">';
      html += '<div class="panel-edge-target">' + escapeHtml(sid) + '</div>';
      if (e.condition) html += '<div class="panel-edge-condition">' + escapeHtml(e.condition) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (d.triggers && d.triggers.length > 0) {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Triggers</div>';
    html += '<div>';
    d.triggers.forEach(t => {
      html += '<span class="panel-trigger">' + escapeHtml(t) + '</span>';
    });
    html += '</div></div>';
  }

  if (d.last_updated && d.last_updated !== '[YYYY-MM-DD]') {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Last updated</div>';
    html += '<div class="panel-description">' + escapeHtml(d.last_updated) + '</div>';
    html += '</div>';
  }

  document.getElementById('panel-tab-info').innerHTML = html;

  // ─── Content tab ───
  const contentHtml = renderNodeContent(d);
  document.getElementById('panel-tab-content').innerHTML = '<div class="content-preview">' + contentHtml + '</div>';

  // Reset to Info tab
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector('.panel-tab[data-tab="info"]').classList.add('active');
  document.getElementById('panel-tab-info').classList.add('active');

  panel.classList.add('open');
  lastPanelNodeId = d.id;
  if (driftOverlayEnabled) renderTimeline(d);
}

function showEdgePanel(edge) {
  const panel = document.getElementById('side-panel');
  const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
  const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
  const relation = describeEdgeRelation(edge.condition || '');

  document.getElementById('panel-title').textContent = relation.label;
  document.getElementById('panel-filename').textContent = sourceId + ' -> ' + targetId;

  const badgeEl = document.getElementById('panel-badge');
  badgeEl.textContent = 'edge';
  badgeEl.style.background = 'rgba(88,166,255,0.15)';
  badgeEl.style.color = '#58a6ff';

  const statusBadgeEl = document.getElementById('panel-status-badge');
  statusBadgeEl.textContent = 'linked';
  statusBadgeEl.style.background = 'rgba(88,166,255,0.15)';
  statusBadgeEl.style.color = '#58a6ff';

  let html = '';
  html += '<div class="panel-section">';
  html += '<div class="panel-section-title">Source</div>';
  html += '<div class="panel-description"><code>' + escapeHtml(sourceId) + '</code></div>';
  html += '</div>';

  html += '<div class="panel-section">';
  html += '<div class="panel-section-title">Target</div>';
  html += '<div class="panel-description"><code>' + escapeHtml(targetId) + '</code></div>';
  html += '</div>';

  html += '<div class="panel-section">';
  html += '<div class="panel-section-title">Relationship</div>';
  html += '<div class="panel-description">' + escapeHtml(relation.description) + '</div>';
  html += '<div class="panel-description" style="margin-top:8px">Confidence: ' + escapeHtml(edge.confidence || 'unknown') + '</div>';
  html += '<div class="panel-description">Source: ' + escapeHtml(edge.sourceType || 'graph') + '</div>';
  html += '</div>';

  if (edge.condition) {
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Condition</div>';
    html += '<div class="panel-description">' + escapeHtml(edge.condition) + '</div>';
    html += '</div>';
  }

  html += '<div class="panel-section">';
  html += '<div class="panel-section-title">Why It Matters</div>';
  html += '<div class="panel-description">' + escapeHtml(relation.why) + '</div>';
  html += '</div>';

  document.getElementById('panel-tab-info').innerHTML = html;
  document.getElementById('panel-tab-content').innerHTML =
    '<div class="content-preview">' +
    '<div class="cp-paragraph"><strong>' + escapeHtml(sourceId) + '</strong></div>' +
    '<div class="cp-paragraph">' + escapeHtml(relation.arrow) + '</div>' +
    '<div class="cp-paragraph"><strong>' + escapeHtml(targetId) + '</strong></div>' +
    (edge.condition ? '<div style="height:8px"></div><div class="cp-paragraph">' + escapeHtml(edge.condition) + '</div>' : '') +
    '</div>';

  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector('.panel-tab[data-tab="info"]').classList.add('active');
  document.getElementById('panel-tab-info').classList.add('active');

  panel.classList.add('open');
  lastPanelNodeId = sourceId;
  if (driftOverlayEnabled) {
    const node = graphData && graphData.nodes.find(n => n.id === sourceId);
    if (node) renderTimeline(node);
  }
}

function describeEdgeRelation(condition) {
  const c = (condition || '').toLowerCase();
  if (c.includes('executes')) {
    return {
      label: 'Execution Edge',
      arrow: 'executes',
      description: 'The source triggers or runs the target.',
      why: 'This helps explain where a command or orchestrator hands work to the implementation.'
    };
  }
  if (c.includes('produces')) {
    return {
      label: 'Output Edge',
      arrow: 'produces',
      description: 'The source creates the target as an output or result structure.',
      why: 'This shows which runtime path materializes a report, graph, or model.'
    };
  }
  if (c.includes('uses data structure')) {
    return {
      label: 'Data Usage Edge',
      arrow: 'uses',
      description: 'The source reads, returns, or depends on the target data model.',
      why: 'This helps trace how shared types and schemas flow through the codebase.'
    };
  }
  if (c.includes('imports')) {
    return {
      label: 'Import Edge',
      arrow: 'imports',
      description: 'The source file imports the target file or module.',
      why: 'This reveals concrete code dependencies and likely execution adjacency.'
    };
  }
  if (c.includes('contains')) {
    return {
      label: 'Containment Edge',
      arrow: 'contains',
      description: 'The source directory or container includes the target.',
      why: 'This makes the structural shape of the project easier to scan.'
    };
  }
  if (c.includes('registers command')) {
    return {
      label: 'Registration Edge',
      arrow: 'registers',
      description: 'The source declares the target as an addressable CLI flow.',
      why: 'This shows where a behavior becomes user-facing.'
    };
  }
  if (c.includes('references code')) {
    return {
      label: 'Reference Edge',
      arrow: 'references',
      description: 'The source documentation points at the target code path.',
      why: 'This is useful for spotting whether scaffold knowledge is tied to real implementation.'
    };
  }
  return {
    label: 'Relationship Edge',
    arrow: 'connects to',
    description: 'The source and target are related in the generated project graph.',
    why: 'This captures one of the inferred or documented links that helps explain structure or flow.'
  };
}

function renderMarkdownContent(text) {
  if (!text || !text.trim()) return '<div style="color:#484f58;padding:20px;">No content</div>';

  const lines = text.split('\n');
  let html = '';
  let inCodeBlock = false;
  let codeContent = '';
  let inComment = false;
  let commentContent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        html += '<div class="cp-code-block">' + escapeHtml(codeContent.trim()) + '</div>';
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    // Multi-line comments
    if (!inComment && trimmed.startsWith('<!--')) {
      if (trimmed.includes('-->')) {
        // Single-line comment
        html += '<div class="cp-comment">' + escapeHtml(trimmed) + '</div>';
      } else {
        inComment = true;
        commentContent = trimmed;
      }
      continue;
    }
    if (inComment) {
      commentContent += '\n' + line;
      if (trimmed.includes('-->')) {
        html += '<div class="cp-comment">' + escapeHtml(commentContent.trim()) + '</div>';
        commentContent = '';
        inComment = false;
      }
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      html += '<div class="cp-heading cp-h3">' + formatInlineMarkdown(trimmed.slice(4)) + '</div>';
    } else if (trimmed.startsWith('## ')) {
      html += '<div class="cp-heading cp-h2">' + formatInlineMarkdown(trimmed.slice(3)) + '</div>';
    } else if (trimmed.startsWith('# ')) {
      html += '<div class="cp-heading cp-h1">' + formatInlineMarkdown(trimmed.slice(2)) + '</div>';
    }
    // List items
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      html += '<div class="cp-list-item">' + formatInlineMarkdown(trimmed.slice(2)) + '</div>';
    }
    // Numbered list
    else if (/^\d+\.\s/.test(trimmed)) {
      html += '<div class="cp-list-item">' + formatInlineMarkdown(trimmed) + '</div>';
    }
    // Table rows
    else if (trimmed.startsWith('|')) {
      html += '<div class="cp-table-row">' + formatInlineMarkdown(trimmed) + '</div>';
    }
    // Empty line
    else if (!trimmed) {
      html += '<div style="height:8px"></div>';
    }
    // Normal text
    else {
      html += '<div class="cp-paragraph">' + formatInlineMarkdown(trimmed) + '</div>';
    }
  }

  return html || '<div style="color:#484f58;padding:20px;">No content</div>';
}

function renderNodeContent(node) {
  if (!node || !node.content || !node.content.trim()) {
    return '<div style="color:#484f58;padding:20px;">No content</div>';
  }

  if (node.type === 'code') {
    if (!/\./.test(node.filename.split('/').pop() || '')) {
      const entries = node.content.split('\n').filter(Boolean);
      if (!entries.length) {
        return '<div style="color:#484f58;padding:20px;">No content</div>';
      }
      return '<div class="cp-directory-list">' +
        entries.map(entry => '<div class="cp-directory-item">' + escapeHtml(entry) + '</div>').join('') +
        '</div>';
    }
    return '<div class="cp-code-block">' + escapeHtml(node.content.trim()) + '</div>';
  }

  return renderMarkdownContent(node.content || '');
}

function formatInlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

// ─── Particle System ───
function initParticles(data) {
  const canvas = document.getElementById('particle-canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  particleCtx = canvas.getContext('2d');

  // Create 1-2 particles per edge
  data.edges.forEach((edge, i) => {
    const count = 1 + (i % 2);
    for (let j = 0; j < count; j++) {
      particles.push({
        edge: edge,
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.002
      });
    }
  });

  requestAnimationFrame(animateParticles);
}

function animateParticles() {
  if (!particleCtx || !svgTransform) {
    requestAnimationFrame(animateParticles);
    return;
  }

  const canvas = particleCtx.canvas;
  particleCtx.clearRect(0, 0, canvas.width, canvas.height);

  particles.forEach(p => {
    p.t += p.speed;
    if (p.t > 1) p.t -= 1;

    const src = p.edge.source;
    const tgt = p.edge.target;
    if (!src || !tgt || src.x == null || tgt.x == null) return;

    // Transform coordinates through SVG transform
    const sx = svgTransform.applyX(src.x);
    const sy = svgTransform.applyY(src.y);
    const tx = svgTransform.applyX(tgt.x);
    const ty = svgTransform.applyY(tgt.y);

    const x = sx + (tx - sx) * p.t;
    const y = sy + (ty - sy) * p.t;

    // Glow
    const gradient = particleCtx.createRadialGradient(x, y, 0, x, y, 6);
    gradient.addColorStop(0, 'rgba(88, 166, 255, 0.6)');
    gradient.addColorStop(1, 'rgba(88, 166, 255, 0)');
    particleCtx.fillStyle = gradient;
    particleCtx.beginPath();
    particleCtx.arc(x, y, 6, 0, Math.PI * 2);
    particleCtx.fill();

    // Core dot
    particleCtx.fillStyle = 'rgba(88, 166, 255, 0.9)';
    particleCtx.beginPath();
    particleCtx.arc(x, y, 1.5, 0, Math.PI * 2);
    particleCtx.fill();
  });

  requestAnimationFrame(animateParticles);
}

// ─── Navigation Simulator ───
function initNavSimulator(data) {
  const input = document.getElementById('nav-input');

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const query = input.value.trim();
      if (query && !navAnimating) {
        runNavSimulation(query, data);
      }
    }
  });

  document.querySelectorAll('.nav-preset').forEach(button => {
    button.addEventListener('click', () => {
      const query = button.dataset.query || '';
      input.value = query;
      if (!navAnimating) {
        runNavSimulation(query, data);
      }
    });
  });
}

function runNavSimulation(query, data) {
  navAnimating = true;
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter(Boolean);
  const edgeList = data.edges.map(edge => ({
    source: typeof edge.source === 'object' ? edge.source.id : edge.source,
    target: typeof edge.target === 'object' ? edge.target.id : edge.target,
    condition: edge.condition || ''
  }));
  const nodeMap = new Map(data.nodes.map(node => [node.id, node]));
  const preset = selectFlowPreset(queryLower);

  if (preset) {
    const presetSteps = preset.nodes
      .map((nodeId, index) => {
        if (!nodeMap.has(nodeId)) return null;
        return {
          nodeId,
          message: preset.messages[index] || ('Following ' + nodeId + '...')
        };
      })
      .filter(Boolean);

    if (presetSteps.length > 0) {
      animateNavSteps(presetSteps, { preset, query, nodes: data.nodes });
      return;
    }
  }

  // Step 1: always start at ROUTER.md
  const steps = [{ nodeId: 'ROUTER.md', message: 'Reading ROUTER.md...' }];

  // Step 2: check routing table
  let routeMatch = null;
  if (data.routing_table) {
    for (const route of data.routing_table) {
      const taskLower = route.task.toLowerCase();
      if (keywords.some(kw => taskLower.includes(kw)) || taskLower.includes(queryLower)) {
        routeMatch = route.target;
        break;
      }
    }
  }

  // Step 3: check node triggers
  let triggerMatch = null;
  for (const node of data.nodes) {
    if (node.triggers && node.triggers.length > 0) {
      for (const trigger of node.triggers) {
        const trigLower = trigger.toLowerCase();
        if (keywords.some(kw => trigLower.includes(kw)) || trigLower.includes(queryLower)) {
          triggerMatch = node.id;
          break;
        }
      }
      if (triggerMatch) break;
    }
  }

  // Step 4: check edge conditions from ROUTER.md
  let conditionMatch = null;
  for (const edge of data.edges) {
    const sid = typeof edge.source === 'object' ? edge.source.id : edge.source;
    if (sid === 'ROUTER.md' && edge.condition) {
      const condLower = edge.condition.toLowerCase();
      if (keywords.some(kw => condLower.includes(kw))) {
        const tid = typeof edge.target === 'object' ? edge.target.id : edge.target;
        conditionMatch = tid;
        break;
      }
    }
  }

  // Build the full navigation path
  // Step 2: find the context file from routing table or edge conditions
  const contextTarget = routeMatch || conditionMatch;

  if (!contextTarget && !triggerMatch) {
    steps.push({ nodeId: null, message: 'No matching route found for "' + query + '"' });
  } else if (contextTarget) {
    // Standard path: ROUTER → context file → INDEX → pattern
    steps.push({ nodeId: contextTarget, message: 'Loading ' + contextTarget + '...' });

    // Step 3: check conventions too if we're writing code and didn't already route there
    if (contextTarget !== 'context/conventions.md' &&
        keywords.some(kw => ['write', 'add', 'create', 'build', 'implement', 'new', 'endpoint', 'route', 'component', 'feature'].includes(kw))) {
      steps.push({ nodeId: 'context/conventions.md', message: 'Loading conventions for code writing...' });
    }

    // Step 4: always check pattern index
    steps.push({ nodeId: 'patterns/INDEX.md', message: 'Checking pattern index...' });

    // Step 5: find a matching pattern file
    let matchedPattern = null;
    for (const node of data.nodes) {
      if (node.type === 'pattern' && node.id !== 'patterns/INDEX.md' && node.id !== 'patterns/README.md') {
        const nameMatch = keywords.some(kw => node.id.toLowerCase().includes(kw));
        const trigMatch = node.triggers && node.triggers.some(t => keywords.some(kw => t.toLowerCase().includes(kw)));
        const descMatch = node.description && keywords.some(kw => node.description.toLowerCase().includes(kw));
        if (nameMatch || trigMatch || descMatch) {
          matchedPattern = node.id;
          break;
        }
      }
    }

    if (matchedPattern) {
      steps.push({ nodeId: matchedPattern, message: 'Found pattern: ' + matchedPattern + ' — following it' });
    } else {
      steps.push({ nodeId: 'patterns/INDEX.md', message: 'No specific pattern found — agent proceeds with context' });
      // Remove duplicate INDEX step
      steps.splice(steps.length - 2, 1);
    }
  } else if (triggerMatch) {
    // Direct trigger match (e.g. typed a keyword that matches a specific file)
    // Still go through the proper chain
    const trigNode = data.nodes.find(n => n.id === triggerMatch);
    if (trigNode && trigNode.type === 'context') {
      steps.push({ nodeId: triggerMatch, message: 'Loading ' + triggerMatch + ' (trigger match)...' });
      steps.push({ nodeId: 'patterns/INDEX.md', message: 'Checking pattern index...' });
    } else if (trigNode && trigNode.type === 'pattern') {
      // Pattern trigger — still load context first
      steps.push({ nodeId: 'context/conventions.md', message: 'Loading conventions first...' });
      steps.push({ nodeId: 'patterns/INDEX.md', message: 'Checking pattern index...' });
      steps.push({ nodeId: triggerMatch, message: 'Found pattern: ' + triggerMatch + ' — following it' });
    } else {
      steps.push({ nodeId: triggerMatch, message: 'Routing to ' + triggerMatch + '...' });
    }
  }

  const conceptualPath = findRelevantConceptPath(keywords, data.nodes);
  conceptualPath.forEach((nodeId, index) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    if (steps.some(step => step.nodeId === nodeId)) return;
    if (node.type === 'command') {
      steps.push({ nodeId, message: 'Following CLI flow through ' + node.filename + '...' });
      return;
    }
    if (node.type === 'data') {
      steps.push({ nodeId, message: index === 0 ? 'Inspecting data model ' + node.name + '...' : 'Relating data model ' + node.name + '...' });
    }
  });

  const flowAnchors = steps
    .map(step => step.nodeId)
    .filter(Boolean)
    .filter(id => nodeMap.has(id));

  const pivotId = flowAnchors[flowAnchors.length - 1] || 'ROUTER.md';
  const codePath = findRelevantCodePath(pivotId, keywords, edgeList, data.nodes);
  codePath.forEach((nodeId, index) => {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    const label = node.type === 'code' && /\./.test(node.filename.split('/').pop() || '')
      ? 'Opening code file ' + node.filename
      : 'Inspecting code area ' + node.filename;
    steps.push({ nodeId, message: index === 0 ? label : 'Tracing into ' + node.filename + '...' });
  });

  if (codePath.length === 0 && flowAnchors.length > 0) {
    const fallback = findRelevantCodePath('src', keywords, edgeList, data.nodes);
    fallback.slice(0, 2).forEach((nodeId, index) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      steps.push({ nodeId, message: index === 0 ? 'Inspecting likely implementation area ' + node.filename + '...' : 'Tracing into ' + node.filename + '...' });
    });
  }

  animateNavSteps(steps, { preset: null, query, nodes: data.nodes });
}

function animateNavSteps(steps, meta = {}) {
  const narration = document.getElementById('nav-narration');
  activeFlowNodeIds = steps.map(step => step.nodeId).filter(Boolean);
  if (flowFocusEnabled) {
    applyFlowFocus(activeFlowNodeIds);
  }
  renderFlowDetails(steps, meta);
  let stepsHtml = steps.map((s, i) =>
    '<div class="nav-step" id="nav-step-' + i + '"><span class="nav-step-arrow">' + (i === 0 ? '>' : '  >') + '</span>' +
    (s.nodeId === null ? '<span class="nav-no-match">' + escapeHtml(s.message) + '</span>' : escapeHtml(s.message)) +
    '</div>'
  ).join('');
  narration.innerHTML = stepsHtml;
  narration.classList.add('visible');

  // Dim all nodes first
  nodeG.transition().duration(300).attr('opacity', 0.15);
  link.transition().duration(300).attr('stroke-opacity', 0.1).attr('stroke', '#30363d').attr('marker-end', 'url(#arrow)');

  // Animate steps
  let stepIndex = 0;
  function animateStep() {
    if (stepIndex >= steps.length) {
      // Done — wait 2s then reset
      setTimeout(() => {
        narration.classList.remove('visible');
        if (flowFocusEnabled && activeFlowNodeIds.length > 0) {
          applyFlowFocus(activeFlowNodeIds);
        } else {
          clearFlowFocus();
        }

        // Reset node sizes
        nodeG.each(function(d) {
          d3.select(this).select('.node-circle').transition().duration(300).attr('r', nodeSize(d));
          d3.select(this).select('.node-glow').transition().duration(300).attr('r', nodeSize(d) + 4).attr('opacity', 0.4);
          d3.select(this).select('.node-status-ring').transition().duration(300).attr('r', nodeSize(d) + 3);
        });

        navAnimating = false;
      }, 2000);
      return;
    }

    const step = steps[stepIndex];
    const stepEl = document.getElementById('nav-step-' + stepIndex);
    if (stepEl) stepEl.classList.add('active');

    // Mark previous as done
    if (stepIndex > 0) {
      const prevEl = document.getElementById('nav-step-' + (stepIndex - 1));
      if (prevEl) { prevEl.classList.remove('active'); prevEl.classList.add('done'); }
    }

    if (step.nodeId) {
      // Highlight this node
      nodeG.filter(n => n.id === step.nodeId)
        .transition().duration(300)
        .attr('opacity', 1);

      // Pulse the node
      nodeG.filter(n => n.id === step.nodeId).each(function(d) {
        d3.select(this).select('.node-circle')
          .transition().duration(300).attr('r', nodeSize(d) * 1.4)
          .transition().duration(300).attr('r', nodeSize(d) * 1.1);
        d3.select(this).select('.node-glow')
          .transition().duration(300).attr('r', nodeSize(d) * 1.4 + 8).attr('opacity', 0.8)
          .transition().duration(300).attr('r', nodeSize(d) + 6).attr('opacity', 0.6);
      });

      // Highlight edge from previous node
      if (stepIndex > 0 && steps[stepIndex - 1].nodeId) {
        const prevId = steps[stepIndex - 1].nodeId;
        const curId = step.nodeId;
        link.filter(e => {
          const sid = typeof e.source === 'object' ? e.source.id : e.source;
          const tid = typeof e.target === 'object' ? e.target.id : e.target;
          return (sid === prevId && tid === curId) || (sid === curId && tid === prevId);
        })
        .transition().duration(300)
        .attr('stroke', '#f0a500')
        .attr('stroke-opacity', 1)
        .attr('stroke-width', 3)
        .attr('marker-end', 'url(#arrow-nav)');
      }
    }

    stepIndex++;
    setTimeout(animateStep, 800);
  }

  setTimeout(animateStep, 300);
}

function applyFlowFocus(nodeIds) {
  const activeSet = new Set(nodeIds);
  nodeG.transition().duration(250)
    .attr('opacity', d => activeSet.has(d.id) ? 1 : 0.08);

  link.transition().duration(250)
    .attr('stroke', e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      return activeSet.has(sid) && activeSet.has(tid) ? '#f0a500' : '#30363d';
    })
    .attr('stroke-opacity', e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      return activeSet.has(sid) && activeSet.has(tid) ? 0.95 : 0.05;
    })
    .attr('stroke-width', e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      return activeSet.has(sid) && activeSet.has(tid) ? 2.5 : 1.2;
    })
    .attr('marker-end', e => {
      const sid = typeof e.source === 'object' ? e.source.id : e.source;
      const tid = typeof e.target === 'object' ? e.target.id : e.target;
      return activeSet.has(sid) && activeSet.has(tid) ? 'url(#arrow-nav)' : 'url(#arrow)';
    });
}

function clearFlowFocus() {
  applyGraphFilters();
}

function clearFlowDetails() {
  const panel = document.getElementById('flow-details');
  panel.classList.remove('visible');
  panel.innerHTML = '';
}

function computeImpactSet(originId, edges, nodes = []) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const origin = nodeMap.get(originId);
  const outgoing = new Map();
  const incoming = new Map();
  edges.forEach(edge => {
    const sid = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const tid = typeof edge.target === 'object' ? edge.target.id : edge.target;
    if (!outgoing.has(sid)) outgoing.set(sid, []);
    if (!incoming.has(tid)) incoming.set(tid, []);
    outgoing.get(sid).push(tid);
    incoming.get(tid).push(sid);
  });

  const impacted = new Set([originId]);

  if (!origin) return Array.from(impacted);

  if (origin.type === 'command') {
    let frontier = [originId];
    for (let depth = 0; depth < 3; depth++) {
      const next = [];
      frontier.forEach(id => {
        (outgoing.get(id) || []).forEach(target => {
          if (!impacted.has(target)) {
            impacted.add(target);
            next.push(target);
          }
        });
      });
      frontier = next;
    }
  } else if (origin.type === 'data') {
    (incoming.get(originId) || []).forEach(source => {
      impacted.add(source);
      (incoming.get(source) || []).forEach(upstream => impacted.add(upstream));
      (outgoing.get(source) || []).forEach(downstream => impacted.add(downstream));
    });
  } else if (origin.type === 'code') {
    (outgoing.get(originId) || []).forEach(target => impacted.add(target));
    (incoming.get(originId) || []).forEach(source => {
      impacted.add(source);
      (incoming.get(source) || []).forEach(upstream => impacted.add(upstream));
    });
  } else {
    let frontier = [originId];
    for (let depth = 0; depth < 2; depth++) {
      const next = [];
      frontier.forEach(id => {
        (outgoing.get(id) || []).forEach(target => {
          if (!impacted.has(target)) {
            impacted.add(target);
            next.push(target);
          }
        });
      });
      frontier = next;
    }
    (incoming.get(originId) || []).forEach(source => impacted.add(source));
  }

  return Array.from(impacted);
}

function renderImpactDetails(originNode, impactIds, nodes, edges) {
  const panel = document.getElementById('flow-details');
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const impactedNodes = impactIds.map(id => nodeMap.get(id)).filter(Boolean);
  const files = impactedNodes
    .filter(node => ['code', 'context', 'root', 'pattern', 'symbol'].includes(node.type))
    .map(node => node.filename)
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, 10);
  const commands = impactedNodes
    .filter(node => node.type === 'command')
    .map(node => node.filename)
    .filter((value, index, array) => array.indexOf(value) === index);
  const dataModels = impactedNodes
    .filter(node => node.type === 'data')
    .map(node => node.name || node.filename)
    .filter((value, index, array) => array.indexOf(value) === index);
  const symbols = impactedNodes
    .filter(node => node.type === 'symbol')
    .map(node => node.name || node.filename)
    .filter((value, index, array) => array.indexOf(value) === index);
  const edgeCount = edges.filter(edge => {
    const sid = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const tid = typeof edge.target === 'object' ? edge.target.id : edge.target;
    return impactIds.includes(sid) && impactIds.includes(tid);
  }).length;
  const modeLabel =
    originNode.type === 'command' ? 'downstream command impact' :
    originNode.type === 'data' ? 'data lineage impact' :
    originNode.type === 'code' ? 'code blast radius' :
    'general impact';

  panel.innerHTML = [
    '<div class="flow-title">impact mode</div>',
    '<div class="flow-subtitle">' + escapeHtml(modeLabel) + '</div>',
    '<div class="flow-subtitle">' + escapeHtml(originNode.filename) + '</div>',
    '<div class="flow-section"><div class="flow-section-title">Affected Scope</div><div class="flow-pill-list">' +
      '<span class="flow-pill">' + escapeHtml(String(impactIds.length)) + ' nodes</span>' +
      '<span class="flow-pill">' + escapeHtml(String(edgeCount)) + ' edges</span>' +
      '</div></div>',
    '<div class="flow-section"><div class="flow-section-title">Commands</div><div class="flow-pill-list">' +
      (commands.length ? commands.map(item => '<span class="flow-pill">' + escapeHtml(item) + '</span>').join('') : '<div class="flow-empty">No impacted commands</div>') +
      '</div></div>',
    '<div class="flow-section"><div class="flow-section-title">Data Models</div><div class="flow-pill-list">' +
      (dataModels.length ? dataModels.map(item => '<span class="flow-pill">' + escapeHtml(item) + '</span>').join('') : '<div class="flow-empty">No impacted data models</div>') +
      '</div></div>',
    '<div class="flow-section"><div class="flow-section-title">Symbols</div><div class="flow-pill-list">' +
      (symbols.length ? symbols.map(item => '<span class="flow-pill">' + escapeHtml(item) + '</span>').join('') : '<div class="flow-empty">No impacted symbols</div>') +
      '</div></div>',
    '<div class="flow-section"><div class="flow-section-title">Relevant Files</div>' +
      (files.length ? files.map(item => '<div class="flow-file">' + escapeHtml(item) + '</div>').join('') : '<div class="flow-empty">No files</div>') +
      '</div>'
  ].join('');
  panel.classList.add('visible');
}

function renderFlowDetails(steps, meta = {}) {
  const panel = document.getElementById('flow-details');
  const nodeMap = new Map((meta.nodes || []).map(node => [node.id, node]));
  const title = meta.preset ? meta.preset.name.replace(/-/g, ' ') : 'custom flow';
  const outputs = [];
  const files = [];
  const stages = [];

  steps.forEach(step => {
    if (!step.nodeId) return;
    const node = nodeMap.get(step.nodeId);
    if (!node) return;

    if ((node.type === 'data' || node.type === 'pattern') && !outputs.includes(node.name || node.filename)) {
      outputs.push(node.name || node.filename);
    }

    if ((node.type === 'command' || node.type === 'context' || node.type === 'root') && !stages.includes(node.name || node.filename)) {
      stages.push(node.name || node.filename);
    }

    if ((node.type === 'code' || node.type === 'root' || node.type === 'context') && !files.includes(node.filename)) {
      files.push(node.filename);
    }
  });

  const html = [
    '<div class="flow-title">' + escapeHtml(title) + '</div>',
    '<div class="flow-subtitle">' + escapeHtml(meta.query || 'Current simulated flow') + '</div>',
    '<div class="flow-section"><div class="flow-section-title">Core Steps</div><div class="flow-pill-list">' +
      (stages.length ? stages.map(item => '<span class="flow-pill">' + escapeHtml(item) + '</span>').join('') : '<div class="flow-empty">No explicit stages</div>') +
      '</div></div>',
    '<div class="flow-section"><div class="flow-section-title">Outputs</div><div class="flow-pill-list">' +
      (outputs.length ? outputs.map(item => '<span class="flow-pill">' + escapeHtml(item) + '</span>').join('') : '<div class="flow-empty">No explicit outputs</div>') +
      '</div></div>',
    '<div class="flow-section"><div class="flow-section-title">Relevant Files</div>' +
      (files.length ? files.slice(0, 10).map(item => '<div class="flow-file">' + escapeHtml(item) + '</div>').join('') : '<div class="flow-empty">No files</div>') +
      '</div>'
  ].join('');

  panel.innerHTML = html;
  panel.classList.add('visible');
}

function selectFlowPreset(queryLower) {
  const ranked = FLOW_PRESETS
    .map(preset => ({
      preset,
      score: preset.keywords.reduce((total, keyword) => total + (queryLower.includes(keyword) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0] && ranked[0].score > 0) {
    return ranked[0].preset;
  }
  return null;
}

function selectFlowPresetForNode(nodeId) {
  const ranked = FLOW_PRESETS
    .map(preset => ({
      preset,
      score: preset.nodes.reduce((total, id, index) => {
        if (id !== nodeId) return total;
        return total + Math.max(1, 8 - index);
      }, 0)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked[0]) {
    return ranked[0].preset;
  }
  return null;
}

function findRelevantCodePath(startId, keywords, edges, nodes) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const queue = [{ id: startId, path: [] }];
  const seen = new Set([startId]);
  let bestPath = [];
  let bestScore = -1;

  while (queue.length) {
    const current = queue.shift();
    const outgoing = edges.filter(edge => edge.source === current.id);

    for (const edge of outgoing) {
      if (seen.has(edge.target)) continue;
      seen.add(edge.target);
      const nextNode = nodeMap.get(edge.target);
      if (!nextNode) continue;
      const nextPath = current.path.concat(edge.target);
      const score = scoreNodeForQuery(nextNode, keywords);
      if (nextNode.type === 'code' && score > bestScore) {
        bestScore = score;
        bestPath = nextPath;
      }
      if (nextPath.length < 4) {
        queue.push({ id: edge.target, path: nextPath });
      }
    }
  }

  if (bestScore <= 0) {
    const ranked = nodes
      .filter(node => node.type === 'code')
      .map(node => ({ id: node.id, score: scoreNodeForQuery(node, keywords) }))
      .sort((a, b) => b.score - a.score);

    if (ranked[0] && ranked[0].score > 0) {
      const pathParts = ranked[0].id.split('/');
      if (pathParts.length > 1) {
        return [pathParts[0], ranked[0].id].filter((v, i, arr) => arr.indexOf(v) === i && nodeMap.has(v));
      }
      return [ranked[0].id];
    }
    return [];
  }

  return bestPath.slice(0, 3);
}

function findRelevantConceptPath(keywords, nodes) {
  const ranked = nodes
    .filter(node => node.type === 'command' || node.type === 'data')
    .map(node => ({ id: node.id, type: node.type, score: scoreConceptNode(node, keywords) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = [];
  const bestCommand = ranked.find(item => item.type === 'command');
  const bestData = ranked.find(item => item.type === 'data');
  if (bestCommand) picked.push(bestCommand.id);
  if (bestData) picked.push(bestData.id);
  return picked;
}

function scoreConceptNode(node, keywords) {
  const haystack = [node.id, node.name || '', node.filename || '', node.description || '', node.content || '']
    .join(' ')
    .toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (keyword.length < 2) continue;
    if (haystack.includes(keyword)) score += 4;
    if ((node.name || '').toLowerCase().includes(keyword)) score += 4;
    if ((node.filename || '').toLowerCase().includes(keyword)) score += 3;
  }

  if (node.type === 'command') {
    const commandBoosts = ['check', 'sync', 'fix', 'doctor', 'update', 'watch', 'setup', 'bootstrap', 'visualize', 'init'];
    if (keywords.some(keyword => commandBoosts.includes(keyword))) score += 5;
  }

  if (node.type === 'data') {
    const dataBoosts = ['data', 'structure', 'types', 'schema', 'model', 'manifest', 'workspace', 'graph', 'entry', 'service'];
    if (keywords.some(keyword => dataBoosts.includes(keyword))) score += 4;
  }

  return score;
}

function scoreNodeForQuery(node, keywords) {
  const haystack = [
    node.id,
    node.name || '',
    node.description || '',
    node.content ? node.content.slice(0, 600) : ''
  ].join(' ').toLowerCase();

  let score = 0;
  for (const keyword of keywords) {
    if (keyword.length < 2) continue;
    if (haystack.includes(keyword)) score += 3;
    if (node.id.toLowerCase().includes(keyword)) score += 4;
  }

  if (node.type === 'code' && /\./.test(node.filename.split('/').pop() || '')) score += 1;
  return score;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeJs(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function openNodeFile(path) {
  fetch('/api/open?path=' + encodeURIComponent(path), { method: 'POST' }).catch(() => {});
}

// Handle resize
window.addEventListener('resize', () => {
  d3.select('#graph')
    .attr('width', window.innerWidth)
    .attr('height', window.innerHeight);

  const canvas = document.getElementById('particle-canvas');
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
});
</script>
</body>
</html>'''


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path == '/api/graph':
            data = scan_scaffold()
            payload = json.dumps(data).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        elif path == '/' or path == '/index.html':
            payload = HTML_PAGE.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        else:
            self.send_error(404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/open':
            raw_path = parse_qs(parsed.query).get('path', [''])[0]
            rel_path = unquote(raw_path).strip()
            abs_path = os.path.join(PROJECT_ROOT, rel_path)
            if not os.path.exists(abs_path):
                abs_path = os.path.join(SCAFFOLD_DIR, rel_path)
            if not os.path.exists(abs_path):
                self.send_error(404)
                return
            try:
                if sys.platform == 'darwin':
                    subprocess.Popen(['open', abs_path])
                else:
                    subprocess.Popen(['xdg-open', abs_path])
                self.send_response(204)
                self.end_headers()
            except Exception:
                self.send_error(500)
            return
        self.send_error(404)

    def log_message(self, format, *args):
        pass


server = HTTPServer(('localhost', PORT), Handler)
server.serve_forever()
PYTHON_SERVER

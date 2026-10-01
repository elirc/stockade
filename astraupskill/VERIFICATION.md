# Distinguish database coverage from provider execution

The backend helper completed twenty-eight tests with no failures or skips. Its TRX records the new merchant-isolation case alongside the existing Fulfil suite. The helper-owned environment marker ensured the PostgreSQL health test ran instead of being skipped. The accepted frontend checks, when appended below, identify their own exact commands and outcomes.

The new database case uses PostgreSQL and actual EF queries through ReadApi.List. It covers pending-state filtering, attempt values on both sides of twelve, distinct merchant totals, and rejection of mismatched account and merchant claims. It calls the API function directly, so it does not certify HTTP routing, cookies, or browser rendering.

The frontend regression calls healthStats with a local object. It checks the two refund labels, recovery guidance, and preservation of a zero inventory-difference value. That is presentation-mapping evidence, not a screenshot or a successful click through the order workflow. Type checking verifies the integration of the mapping into the existing panel source.

The added scripts/integration.mjs HTTP scenario is supplied for the full local integration harness but was not executed in this acceptance run. The equivalent merchant and retry-boundary behavior was checked directly against the owned PostgreSQL database.

No real refund, external provider call, deployment, or production data mutation is part of this acceptance scope. Counts remain separate reads and do not promise an atomic reporting snapshot under concurrent worker updates. Original snapshots and recorded commands accompany the changed source. Earlier captured backend checks remain historical evidence; the fresh twenty-eight-case run is the evidence for the newly added database test, and repeated cases are not counted twice.

## Source excerpt

From [scripts/test-refund-health.py](../scripts/test-refund-health.py).

```py
"""Run the Fulfil tests against a helper-owned temporary PostgreSQL cluster."""
from pathlib import Path
import argparse
import os
import shutil
import socket
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--postgres-bin', default='C:/Program Files/PostgreSQL/18/bin')
parser.add_argument('--dotnet', default='dotnet')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
binary = Path(args.postgres_bin)
suffix = '.exe' if os.name == 'nt' else ''
scratch = Path(tempfile.mkdtemp(prefix='astra5-health-')).resolve()
assert scratch.parent == Path(tempfile.gettempdir()).resolve() and scratch.name.startswith('astra5-health-')
data = scratch/'data'
flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
started = False

def run(command, **kwargs):
    print("Running: " + " ".join(map(str, command)), flush=True)
    return subprocess.run(command, stdout=sys.stdout, stderr=subprocess.STDOUT, creationflags=flags, **kwargs)

try:
    run([str(binary/('initdb'+suffix)), '-D', str(data), '-U', 'astra_test', '-A', 'trust', '--no-locale', '--no-sync', '-E', 'UTF8'], check=True)
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    run([str(binary/('pg_ctl'+suffix)), '-D', str(data), '-l', str(scratch/'postgres.log'), '-o', f'-p {port} -h 127.0.0.1', '-w', 'start'], check=True)
    started = True
    run([str(binary/('createdb'+suffix)), '-h', '127.0.0.1', '-p', str(port), '-U', 'astra_test', 'astra5_health_test'], check=True)
    env = os.environ.copy()
    env['ASTRA5_OWNED_HEALTH_DATABASE'] = '1'
    env['ASTRA5_HEALTH_TEST_CONNECTION'] = f'Host=127.0.0.1;Port={port};Username=astra_test;Database=astra5_health_test;Pooling=false'
    result = run([args.dotnet, 'test', 'tests/Fulfil.Tests/Fulfil.Tests.csproj', '--no-restore', '--nologo', '--verbosity', 'minimal', '--logger', 'trx', '/m:1'], cwd=root, env=env)
finally:
    if started:
        run([str(binary/('pg_ctl'+suffix)), '-D', str(data), '-m', 'fast', '-w', 'stop'], check=True)
    assert scratch.parent == Path(tempfile.gettempdir()).resolve() and scratch.name.startswith('astra5-health-')
    shutil.rmtree(scratch)
raise SystemExit(result.returncode)
```

## Course navigation

[README](README.md) / [01-CODEBASE-MAP](01-CODEBASE-MAP.md) / [02-CONCEPTS](02-CONCEPTS.md) / [03-WORKED-CHANGE](03-WORKED-CHANGE.md) / [04-TESTING-AND-DEBUGGING](04-TESTING-AND-DEBUGGING.md) / [05-PRACTICE](05-PRACTICE.md) / [06-SOLUTIONS-AND-REVIEW](06-SOLUTIONS-AND-REVIEW.md) / [07-TRACE-LAB](07-TRACE-LAB.md) / [VERIFICATION](VERIFICATION.md)

## Recorded command evidence

The accepted test evidence covers **34 distinct passing tests**. The commands below define the verified scope; repeated targeted runs do not increase the count.

| Check | Recorded command | Exit | Evidence |
|---|---|---:|---|
| `astra-astra5-health-tests-r1` | `["python", "scripts/test-refund-health.py"]` | 0 | [record](evidence/astra-astra5-health-tests-r1.json), [log](evidence/astra-astra5-health-tests-r1.log) |
| `astra-astra5-ui-tests-r1` | `["node", "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js", "run", "test", "--", "--maxWorkers=1", "--minWorkers=1", "--testTimeout=30000"]` | 0 | [record](evidence/astra-astra5-ui-tests-r1.json), [log](evidence/astra-astra5-ui-tests-r1.log) |
| `astra-astra5-typecheck-r1` | `["node", "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js", "run", "typecheck"]` | 0 | [record](evidence/astra-astra5-typecheck-r1.json), [log](evidence/astra-astra5-typecheck-r1.log) |

[Machine-readable results 1](evidence/regression.trx).

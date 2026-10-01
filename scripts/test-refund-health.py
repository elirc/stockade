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

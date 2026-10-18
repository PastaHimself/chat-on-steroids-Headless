#!/usr/bin/env python3
"""Local, root-only maintenance. No network upload, credential output, or automatic restart."""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import grp
import shutil
import stat
import subprocess
import tarfile
import tempfile
import uuid

INSTALL = Path('/opt/chat-on-steroids')
SYSTEMD = Path('/etc/systemd/system')
UNITS = ['cos-headless.target', 'cos-display.service', 'cos-session.service', 'cos-browser.service', 'cos-backend.service', 'cos-discord.service']
GUARD = 'cos-maintenance-recovery.service'
DATA = [Path('/var/lib/cos-backend'), Path('/var/lib/cos-discord'), Path('/etc/chat-on-steroids'), Path('/srv/cos-projects')]


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def atomic_json(file, value):
    temporary = file.with_name(file.name + '.tmp-' + str(uuid.uuid4()))
    try:
        with temporary.open('x', encoding='utf8') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, sort_keys=True)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, file); sync_directory(file.parent)
    finally: temporary.unlink(missing_ok=True)


def remove(file):
    if file.is_dir() and not file.is_symlink(): shutil.rmtree(file)
    else: file.unlink(missing_ok=True)


def inventory(directory, flush=False):
    rows = {}
    for file in sorted(directory.rglob('*')):
        info = file.lstat(); name = file.relative_to(directory).as_posix()
        row = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
        if file.is_symlink():
            target = os.readlink(file)
            if os.path.isabs(target) or not file.resolve().is_relative_to(directory.resolve()):
                raise RuntimeError('Backup or staged tree contains a link outside its root: ' + name)
            row.update(kind='link', target=target)
        elif file.is_dir(): row.update(kind='directory')
        elif file.is_file():
            digest = hashlib.sha256()
            with file.open('rb') as stream:
                while block := stream.read(1024 * 1024): digest.update(block)
                if flush: os.fsync(stream.fileno())
            row.update(kind='file', sha256=digest.hexdigest(), size=info.st_size)
        else: raise RuntimeError('Backup or staged tree contains a special file: ' + name)
        rows[name] = row
    if flush:
        for file in reversed([directory] + [file for file in directory.rglob('*') if file.is_dir() and not file.is_symlink()]): sync_directory(file)
    return rows


def stop_stack():
    subprocess.run(['systemctl', 'stop', *UNITS, GUARD], check=True)


def reload_units():
    subprocess.run(['systemctl', 'daemon-reload'], check=True)


class Replacement:
    """A durable multi-path replacement. Interrupted work always rolls back while stopped."""
    def __init__(self, directory, allowed, stop=stop_stack, reload=reload_units):
        self.directory = Path(directory)
        self.file = self.directory / 'installation.json'
        self.allowed = set(map(str, allowed)); self.stop = stop; self.reload = reload

    def read(self):
        if not self.file.exists(): return None
        info = self.file.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > 65536:
            raise RuntimeError('Installation journal is unsafe')
        value = json.loads(self.file.read_text())
        if value['version'] != 1 or value['phase'] not in ['prepared', 'stopping', 'replacing', 'committed', 'rolled-back']:
            raise RuntimeError('Installation journal is incompatible')
        for row in value['paths']:
            if row['destination'] not in self.allowed or not Path(row['source']).is_relative_to(self.directory) or not Path(row['backup']).is_relative_to(self.directory):
                raise RuntimeError('Installation journal has invalid ownership')
        return value

    def recover(self):
        value = self.read()
        if not value or value['phase'] in ['committed', 'rolled-back']: return False
        self.stop()
        for row in reversed(value['paths']):
            source, destination, backup = map(Path, [row['source'], row['destination'], row['backup']])
            if backup.exists() or backup.is_symlink():
                remove(destination); os.replace(backup, destination); sync_directory(destination.parent)
            elif not row['existed'] and not source.exists():
                remove(destination); sync_directory(destination.parent)
        self.reload(); value['phase'] = 'rolled-back'; atomic_json(self.file, value)
        return True

    def commit(self, pairs, previous, before_replace=None):
        self.recover()
        previous.mkdir(mode=0o700)
        rows = []
        for index, (source, destination) in enumerate(pairs):
            if str(destination) not in self.allowed or destination.is_symlink(): raise RuntimeError('Refusing an unmanaged or linked destination')
            rows.append(dict(source=str(source), destination=str(destination), backup=str(previous / str(index)), existed=destination.exists()))
        value = dict(version=1, phase='prepared', paths=rows)
        atomic_json(self.file, value)
        value['phase'] = 'stopping'; atomic_json(self.file, value); self.stop()
        if before_replace:
            try: before_replace()
            except Exception:
                # No destination moved yet; retain the stopped stack and a settled journal.
                value['phase'] = 'rolled-back'; atomic_json(self.file, value)
                raise
        value['phase'] = 'replacing'; atomic_json(self.file, value)
        for row in rows:
            source, destination, backup = map(Path, [row['source'], row['destination'], row['backup']])
            destination.parent.mkdir(parents=True, exist_ok=True)
            if row['existed']:
                os.replace(destination, backup); sync_directory(destination.parent); sync_directory(backup.parent)
            os.replace(source, destination); sync_directory(destination.parent); sync_directory(source.parent)
        self.reload()
        value['phase'] = 'committed'; atomic_json(self.file, value)
        return previous


def allowed_paths():
    return [INSTALL / 'current', INSTALL / 'maintenance.py', *DATA,
        *[SYSTEMD / name for name in UNITS + [GUARD]],
        *[SYSTEMD / (name + '.d') / 'cos-maintenance.conf' for name in UNITS]]


def code_formats(code):
    file = code / 'runtime/durable-formats.json'
    if file.exists(): return json.loads(file.read_text())
    # The original headless checkout predates format manifests and restore latches.
    return {'version': 1, 'backendReceipts': 1, 'botReceipts': 1, 'goalTransactions': 1, 'restoreHold': 0}


def compatible(formats):
    if formats.get('version') != 1: raise RuntimeError('Code format manifest is incompatible')
    for directory in [DATA[0] / 'app', DATA[1]]:
        file = directory / 'durable-formats.json'
        if not file.exists(): continue
        floor = json.loads(file.read_text())
        if floor.get('version') != 1 or any(not isinstance(version, int) or version > formats.get(key, 0) for key, version in floor.items()):
            raise RuntimeError('Incompatible rollback refused. Restore this code with its matching encrypted backup and reconcile locally.')


def public_directory(directory):
    # Only code and managed service directories belong here, never persistent DATA.
    if directory.is_symlink(): raise RuntimeError('Managed directory must not be linked: ' + str(directory))
    directory.mkdir(parents=True, exist_ok=True)
    os.chown(directory, 0, 0); os.chmod(directory, 0o755)


def normalize_code(code):
    for file in [code, *code.rglob('*')]:
        if file.is_symlink():
            os.chown(file, 0, 0, follow_symlinks=False)
            continue
        mode = file.stat().st_mode
        if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise RuntimeError('Code contains a special file: ' + str(file))
        os.chown(file, 0, 0)
        # copytree preserves restrictive source modes; umask also masks code.mkdir.
        # Runtime accounts must traverse/read code, while only root may modify it.
        os.chmod(file, 0o755 if stat.S_ISDIR(mode) or mode & 0o111 else 0o644)
    os.chmod(code / 'node_modules/electron/dist/chrome-sandbox', 0o4755)
    for file in (code / 'deploy').glob('*.sh'): os.chmod(file, 0o755)


def verify_build(code, payload=False):
    subprocess.run(['/usr/local/bin/node', str(code / 'scripts/verify-headless-build.mjs'), '--root', str(code),
                    *(['--payload'] if payload else [])], check=True)


def install(source):
    Replacement(INSTALL, allowed_paths()).recover()
    public_directory(INSTALL)
    verify_build(source)
    required = ['package.json', 'package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.txt', 'node_modules', 'out', 'extension', 'discord', 'deploy', 'runtime']
    for name in ['out/main/index.js', 'discord/dist/index.js', 'node_modules/electron/dist/electron', 'node_modules/electron/dist/chrome-sandbox', 'runtime/durable-formats.json']:
        if not (source / name).is_file(): raise RuntimeError('Incomplete update: ' + name)
    compatible(code_formats(source))
    stage = Path(tempfile.mkdtemp(prefix='stage-', dir=INSTALL)); code = stage / 'current'; code.mkdir(mode=0o755)
    try:
        for name in required + [name for name in ['resources', 'native'] if (source / name).exists()]:
            origin, target = source / name, code / name
            if origin.is_dir(): shutil.copytree(origin, target, symlinks=True)
            else: shutil.copy2(origin, target)
        scripts = code / 'scripts'; scripts.mkdir()
        for name in ['headless-provenance.mjs', 'verify-headless-build.mjs', 'headless-native-probe.cjs']:
            shutil.copy2(source / 'scripts' / name, scripts / name)
        normalize_code(code)
        verify_build(code, payload=True)
        formats = code_formats(code); compatible(formats)
        helper = stage / 'maintenance.py'; shutil.copy2(code / 'deploy/maintenance.py', helper); os.chmod(helper, 0o755)
        units = stage / 'units'; units.mkdir()
        pairs = [(code, INSTALL / 'current'), (helper, INSTALL / 'maintenance.py')]
        for name in UNITS + [GUARD]:
            unit = code / 'deploy/systemd' / name
            if not unit.read_text().startswith('# Managed by Chat On Steroids headless deployment\n'): raise RuntimeError('Unmanaged unit in update')
            target = SYSTEMD / name
            if target.exists() and not target.read_text().startswith('# Managed by Chat On Steroids headless deployment\n'): raise RuntimeError('Refusing to replace an unmanaged service')
            shutil.copy2(unit, units / name); os.chmod(units / name, 0o644); pairs.append((units / name, target))
        rows = inventory(stage, flush=True)
        atomic_json(stage / 'verified.json', {'version': 1, 'contents': rows, 'formats': formats})
        # Re-read the complete staged contents before any service is stopped.
        actual = inventory(stage); actual.pop('verified.json')
        if actual != rows: raise RuntimeError('Staged contents changed during verification')
        # A running old process can advance its durable floor during staging. Only
        # the floor read after systemctl stop may authorize the replacement.
        previous = Replacement(INSTALL, allowed_paths()).commit(pairs, INSTALL / ('previous-' + str(uuid.uuid4())),
                                                               before_replace=lambda: compatible(formats))
        print('Verified update installed. Previous code and units: ' + str(previous))
        print('Services remain stopped. Start locally only after reviewing health and acceptance results.')
    finally:
        # Keep an interrupted stage referenced by the journal for deterministic recovery.
        journal = Replacement(INSTALL, allowed_paths()).read()
        if not journal or journal['phase'] in ['committed', 'rolled-back']: remove(stage)


def copy_owned_tree(origin, target):
    def ignore_transient(directory, names):
        # Keyring/DBus sockets are process-local endpoints, not restorable data.
        ignored = set(shutil.ignore_patterns('SingletonLock', 'SingletonSocket', 'SingletonCookie')(directory, names))
        for name in names:
            try:
                if stat.S_ISSOCK((Path(directory) / name).lstat().st_mode):
                    ignored.add(name)
            except FileNotFoundError:
                # A runtime endpoint can disappear between directory listing and lstat.
                ignored.add(name)
        return ignored

    shutil.copytree(origin, target, symlinks=True, ignore=ignore_transient)
    for file in [target, *target.rglob('*')]:
        source = origin / file.relative_to(target)
        info = source.lstat()
        os.chown(file, info.st_uid, info.st_gid, follow_symlinks=False)
        shutil.copystat(source, file, follow_symlinks=False)


def bootstrap(source):
    # Independent of current/, so recovery is available even if that directory vanished.
    public_directory(INSTALL)
    helper = INSTALL / 'maintenance.py'
    temporary = INSTALL / ('maintenance-' + str(uuid.uuid4()) + '.tmp')
    shutil.copy2(source / 'deploy/maintenance.py', temporary); os.chown(temporary, 0, 0); os.chmod(temporary, 0o755)
    with temporary.open('rb') as stream: os.fsync(stream.fileno())
    os.replace(temporary, helper); sync_directory(INSTALL)
    for name in [GUARD]:
        target = SYSTEMD / name
        if target.is_symlink() or (target.exists() and not target.read_text().startswith('# Managed by Chat On Steroids headless deployment\n')):
            raise RuntimeError('Unmanaged maintenance recovery unit')
        shutil.copy2(source / 'deploy/systemd' / name, target); os.chown(target, 0, 0); os.chmod(target, 0o644)
    # Old units also require the guard before the first transactional upgrade.
    for name in UNITS:
        directory = SYSTEMD / (name + '.d')
        public_directory(directory)
        target = directory / 'cos-maintenance.conf'
        text = '# Managed by Chat On Steroids headless deployment\n[Unit]\nRequires=' + GUARD + '\nAfter=' + GUARD + '\n'
        if target.is_symlink() or (target.exists() and target.read_text() != text): raise RuntimeError('Unmanaged recovery guard drop-in')
        target.write_text(text); os.chown(target, 0, 0); os.chmod(target, 0o644)
    reload_units()


def boot_guard():
    transaction = Replacement(INSTALL, allowed_paths(), stop=lambda: None)
    journal = transaction.read()
    if journal and journal['phase'] == 'rolled-back' and journal.get('reviewRequired'):
        raise RuntimeError('Interrupted replacement needs local review. Run maintenance recover locally before resetting the failed unit and starting the stack.')
    if journal and journal['phase'] not in ['committed', 'rolled-back']:
        for name in UNITS[1:]:
            if subprocess.run(['systemctl', 'is-active', '--quiet', name]).returncode == 0:
                raise RuntimeError('A service is active during interrupted replacement; stop the stack and recover locally')
        # Persist the review requirement before rollback, so another reboot cannot bypass it.
        journal['reviewRequired'] = True; atomic_json(transaction.file, journal)
        transaction.recover()
        raise RuntimeError('Interrupted replacement rolled back. Review locally, reset the failed recovery unit and start the stack explicitly.')
    latch = DATA[0] / 'app/restore-hold.json'
    if (latch.exists() or latch.is_symlink()) and code_formats(INSTALL / 'current').get('restoreHold', 0) < 1:
        if latch.is_symlink() or not latch.is_file() or latch.stat().st_size > 4096: raise RuntimeError('Legacy restore hold is invalid; reconcile locally')
        value = json.loads(latch.read_text())
        if value.get('version') != 1 or value.get('held') is not False:
            raise RuntimeError('Legacy restored code cannot honor the recovery hold. Reconcile locally before starting any runtime service.')


def recover_locally():
    transaction = Replacement(INSTALL, allowed_paths())
    recovered = transaction.recover()
    journal = transaction.read()
    if journal and journal['phase'] == 'rolled-back' and journal.get('reviewRequired'):
        journal['reviewRequired'] = False; atomic_json(transaction.file, journal)
        print('Local review acknowledged. Services remain stopped; reset the failed recovery unit and start explicitly.')
    return recovered


def account_metadata():
    return {**{name: {'uid': pwd.getpwnam(name).pw_uid, 'gid': grp.getgrnam(name).gr_gid} for name in ['cos-backend', 'cos-discord']}, 'cos-control': {'gid': grp.getgrnam('cos-control').gr_gid}}


def backup(output):
    if output.exists(): raise RuntimeError('Backup destination already exists')
    if any(output.is_relative_to(source) for source in allowed_paths()): raise RuntimeError('Backup output must be outside the source directories')
    if output.suffix != '.gpg': raise RuntimeError('Backups must be encrypted .gpg files')
    stop_stack()
    with tempfile.TemporaryDirectory(prefix='backup-', dir=INSTALL) as temporary:
        stage = Path(temporary); payload = stage / 'payload'; payload.mkdir(mode=0o700)
        for file in allowed_paths():
            if not file.exists(): continue
            target = payload / str(file).lstrip('/'); target.parent.mkdir(parents=True, exist_ok=True)
            if file.is_dir():
                # Process-local locks/sockets cannot be restored; services are stopped first.
                copy_owned_tree(file, target)
            else:
                shutil.copy2(file, target); info = file.stat(); os.chown(target, info.st_uid, info.st_gid)
        rows = inventory(payload)
        formats = code_formats(INSTALL / 'current')
        atomic_json(stage / 'manifest.json', {'version': 1, 'accounts': account_metadata(), 'formats': formats, 'contents': rows})
        archive = stage / 'snapshot.tar'
        with tarfile.open(archive, 'w') as stream:
            stream.add(payload, arcname='payload', recursive=True); stream.add(stage / 'manifest.json', arcname='manifest.json')
        encrypted = stage / 'snapshot.gpg'
        subprocess.run(['gpg', '--no-symkey-cache', '--symmetric', '--cipher-algo', 'AES256', '--output', str(encrypted), str(archive)], check=True)
        # Publish encrypted bytes exclusively; never overwrite an earlier backup.
        output.parent.mkdir(parents=True, exist_ok=True)
        with encrypted.open('rb') as source, output.open('xb') as target:
            os.chmod(output, 0o600); shutil.copyfileobj(source, target); target.flush(); os.fsync(target.fileno())
        sync_directory(output.parent)
    print('Encrypted backup complete. Services remain stopped: ' + str(output))


def unpack_verified(archive, directory):
    with tarfile.open(archive, 'r:') as stream:
        members = stream.getmembers()
        if len(members) > 2_000_000: raise RuntimeError('Backup member capacity exceeded')
        seen = set()
        for member in members:
            name = Path(member.name)
            if not name.parts or name.is_absolute() or '..' in name.parts or name.as_posix() != member.name.rstrip('/') or name.as_posix() in seen or name.parts[0] not in ['payload', 'manifest.json']:
                raise RuntimeError('Backup has an invalid or duplicate path')
            if not (member.isdir() or member.isfile() or member.issym()): raise RuntimeError('Backup contains a special file')
            if member.issym():
                link = Path(member.linkname)
                resolved = (directory / name.parent / link).resolve()
                if link.is_absolute() or not resolved.is_relative_to(directory / 'payload'): raise RuntimeError('Backup link escapes its payload')
            seen.add(name.as_posix())
        # Reject descendants of symlinks before extracting even a single byte.
        links = {member.name for member in members if member.issym()}
        for member in members:
            if any(parent.as_posix() in links for parent in Path(member.name).parents): raise RuntimeError('Backup writes through a link')
        stream.extractall(directory, members=members, filter='fully_trusted')
    manifest = json.loads((directory / 'manifest.json').read_text())
    if manifest.get('version') != 1 or inventory(directory / 'payload') != manifest['contents']:
        raise RuntimeError('Backup checksum or ownership verification failed')
    return manifest


def restore(input_file):
    transaction = Replacement(INSTALL, allowed_paths()); transaction.recover(); stop_stack()
    stage = Path(tempfile.mkdtemp(prefix='restore-', dir=INSTALL))
    try:
        archive = stage / 'snapshot.tar'
        subprocess.run(['gpg', '--no-symkey-cache', '--output', str(archive), '--decrypt', str(input_file)], check=True)
        manifest = unpack_verified(archive, stage)
        if manifest['accounts'] != account_metadata(): raise RuntimeError('Service account ownership differs; reconcile account IDs before restore')
        payload = stage / 'payload'
        code = payload / str(INSTALL / 'current').lstrip('/')
        if code_formats(code) != manifest['formats']: raise RuntimeError('Backup code format mismatch')
        # A restore uses matching backed-up code and data, rather than a code-only rollback.
        latch = payload / str(DATA[0] / 'app/restore-hold.json').lstrip('/')
        latch.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(latch, {'version': 1, 'held': True, 'backup': input_file.name, 'restoredAt': __import__('time').time()})
        os.chown(latch, manifest['accounts']['cos-backend']['uid'], manifest['accounts']['cos-backend']['gid'])
        pairs = []
        for destination in allowed_paths():
            source = payload / str(destination).lstrip('/')
            if not source.exists(): raise RuntimeError('Backup is missing required installation state: ' + str(destination))
            pairs.append((source, destination))
        inventory(payload, flush=True)
        previous = transaction.commit(pairs, INSTALL / ('before-restore-' + str(uuid.uuid4())))
        print('Verified backup restored with delivery, automation and worker revival held. Previous state: ' + str(previous))
        print('Inspect receipts locally, record reconciliation and release the hold while services are stopped.')
    finally:
        journal = transaction.read()
        if not journal or journal['phase'] in ['committed', 'rolled-back']: remove(stage)


def release_hold(reconciliation):
    # Evidence is retained privately beside the latch. It must describe local receipt review.
    if not reconciliation.is_file() or reconciliation.is_symlink() or not 20 <= reconciliation.stat().st_size <= 1024 * 1024:
        raise RuntimeError('Provide a local reconciliation record (20 bytes–1 MiB) after reviewing repeated work')
    stop_stack()
    latch = DATA[0] / 'app/restore-hold.json'
    value = json.loads(latch.read_text())
    if value.get('version') != 1 or value.get('held') is not True: raise RuntimeError('No valid restore hold to release')
    destination = latch.parent / ('reconciliation-' + str(uuid.uuid4()) + '.txt')
    shutil.copyfile(reconciliation, destination); os.chmod(destination, 0o600)
    account = pwd.getpwnam('cos-backend'); os.chown(destination, account.pw_uid, account.pw_gid)
    with destination.open('rb') as stream: os.fsync(stream.fileno())
    atomic_json(latch, {**value, 'held': False, 'reconciliation': destination.name}); os.chown(latch, account.pw_uid, account.pw_gid)
    with latch.open('rb') as stream: os.fsync(stream.fileno())
    print('Reconciliation recorded and restore hold released. Services remain stopped; start locally.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('recover')
    sub.add_parser('boot-guard')
    sub.add_parser('bootstrap').add_argument('--source', type=Path, required=True)
    sub.add_parser('install').add_argument('--source', type=Path, required=True)
    sub.add_parser('backup').add_argument('--output', type=Path, required=True)
    sub.add_parser('restore').add_argument('--input', type=Path, required=True)
    sub.add_parser('release-hold').add_argument('--reconciliation', type=Path, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0: parser.error('Run local maintenance with sudo; services remain unprivileged')
    INSTALL.mkdir(parents=True, exist_ok=True)
    if INSTALL.is_symlink(): raise RuntimeError('Installation root must not be linked')
    lock_file = INSTALL / 'maintenance.lock'
    with lock_file.open('a') as lock:
        os.chmod(lock_file, 0o600); fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == 'recover':
            recovered = recover_locally(); print('Interrupted replacement rolled back; services remain stopped.' if recovered else 'No interrupted replacement.')
        elif args.command == 'boot-guard': boot_guard()
        elif args.command == 'bootstrap': bootstrap(args.source.resolve())
        elif args.command == 'install': install(args.source.resolve())
        elif args.command == 'backup': backup(args.output.resolve())
        elif args.command == 'restore': restore(args.input.resolve())
        else: release_hold(args.reconciliation.resolve())

if __name__ == '__main__':
    try: main()
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError, KeyError) as error:
        print('Maintenance stopped: ' + str(error), file=__import__('sys').stderr); raise SystemExit(1)

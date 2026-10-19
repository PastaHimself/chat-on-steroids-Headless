"""Unprivileged fault drills for the same replacement/recovery code used on a VPS."""
import importlib.util
import json
from pathlib import Path
import os
import tarfile
import tempfile
import subprocess
import shutil
import socket
import stat
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).resolve().parents[1] / 'deploy/maintenance.py')
maintenance = importlib.util.module_from_spec(spec); spec.loader.exec_module(maintenance)

class MaintenanceDrills(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='cos-maintenance-drill-')
        self.directory = Path(self.temporary.name); self.install = self.directory / 'install'; self.install.mkdir()
        self.source = self.install / 'stage'; self.source.mkdir(); (self.source / 'value').write_text('new code')
        self.destination = self.directory / 'current'; self.destination.mkdir(); (self.destination / 'value').write_text('old code')
        self.stops = []
        self.transaction = maintenance.Replacement(self.install, [self.destination], stop=lambda: self.stops.append(True), reload=lambda: None)
    def tearDown(self): self.temporary.cleanup()

    def installation_fixture(self):
        source = self.directory / 'build'; source.mkdir()
        for name in ['package.json', 'package-lock.json', 'LICENSE', 'THIRD-PARTY-NOTICES.txt',
                     'out/main/index.js', 'discord/dist/index.js', 'discord/node_modules/fixture.js', 'discord/package.json',
                     'discord/package-lock.json', 'discord/THIRD-PARTY-NOTICES.txt', 'discord/licenses/fixture.txt', 'node_modules/electron/dist/electron',
                     'node_modules/electron/dist/chrome-sandbox', 'extension/manifest.json',
                     'scripts/headless-provenance.mjs', 'scripts/verify-headless-build.mjs', 'scripts/headless-native-probe.cjs',
                     'deploy/maintenance.py', 'deploy/start-backend.sh']:
            file = source / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('fixture')
        formats = source / 'runtime/durable-formats.json'; formats.parent.mkdir()
        formats.write_text(json.dumps({'version': 1, 'backendReceipts': 2}))
        for name in maintenance.UNITS + [maintenance.GUARD]:
            unit = source / 'deploy/systemd' / name; unit.parent.mkdir(exist_ok=True)
            unit.write_text('# Managed by Chat On Steroids headless deployment\n[Unit]\n')
        for file in source.rglob('*'):
            if file.is_dir(): file.chmod(0o700)
            else: file.chmod(0o600)
        (source / 'node_modules/electron/dist/electron').chmod(0o700)
        # Strip inherited privilege bits; only Chromium's sandbox may be setuid.
        (source / 'out/main/index.js').chmod(0o6600)
        return source

    def test_install_with_private_umask_publishes_traversable_root_owned_code_only(self):
        source = self.installation_fixture(); self.install.chmod(0o700)
        private = source / 'discord/.env'; private.write_text('private login fixture'); private.chmod(0o600)
        units = self.directory / 'systemd'; units.mkdir()
        homes = [self.directory / name for name in ['backend', 'discord', 'configuration', 'projects']]
        for home in homes: home.mkdir(mode=0o700)
        secret = homes[2] / 'backend.env'; secret.write_text('private fixture'); secret.chmod(0o600)
        ownership = []
        def owned(file, uid, gid, **options): ownership.append((str(file), uid, gid, options))
        old_umask = os.umask(0o077)
        try:
            with patch.object(maintenance, 'INSTALL', self.install), patch.object(maintenance, 'SYSTEMD', units), \
                 patch.object(maintenance, 'DATA', homes), patch.object(maintenance.os, 'chown', side_effect=owned), \
                 patch.object(maintenance.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                maintenance.bootstrap(source)
                maintenance.install(source)
        finally: os.umask(old_umask)
        code = self.install / 'current'
        self.assertFalse((code / 'discord/.env').exists())
        self.assertEqual(private.read_text(), 'private login fixture')
        self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o600)
        for file in [code, self.install, *[file for file in code.rglob('*') if file.is_dir()],
                     *[units / (name + '.d') for name in maintenance.UNITS]]:
            self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o755, str(file))
        for file in code.rglob('*'):
            mode = stat.S_IMODE(file.stat().st_mode)
            self.assertFalse(mode & 0o022, str(file))
            if file.is_file(): self.assertTrue(mode & 0o044 == 0o044, str(file))
            self.assertIn((str(file).replace(str(code), next(path for path, _, _, _ in ownership if path.endswith('/current'))), 0, 0, {}), ownership)
        self.assertEqual(stat.S_IMODE((code / 'node_modules/electron/dist/chrome-sandbox').stat().st_mode), 0o4755)
        self.assertEqual(stat.S_IMODE((code / 'out/main/index.js').stat().st_mode), 0o644)
        self.assertEqual(stat.S_IMODE((code / 'node_modules/electron/dist/electron').stat().st_mode), 0o755)
        for home in homes: self.assertEqual(stat.S_IMODE(home.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(secret.stat().st_mode), 0o600)
        self.assertEqual(secret.read_text(), 'private fixture')

    def test_install_rechecks_durable_floor_after_stopping_before_replacement(self):
        source = self.installation_fixture()
        units = self.directory / 'systemd'; units.mkdir()
        homes = [self.directory / 'backend', self.directory / 'discord']
        app = homes[0] / 'app'; app.mkdir(parents=True)
        floor = app / 'durable-formats.json'; floor.write_text(json.dumps({'version': 1, 'backendReceipts': 2}))
        code = self.install / 'current'; code.mkdir(); (code / 'value').write_text('old code')
        def stopping(args, **options):
            if args[:2] == ['systemctl', 'stop']:
                floor.write_text(json.dumps({'version': 1, 'backendReceipts': 3}))
            return subprocess.CompletedProcess(args, 0)
        with patch.object(maintenance, 'INSTALL', self.install), patch.object(maintenance, 'SYSTEMD', units), \
             patch.object(maintenance, 'DATA', homes), patch.object(maintenance.os, 'chown'), \
             patch.object(maintenance.subprocess, 'run', side_effect=stopping):
            with self.assertRaisesRegex(RuntimeError, 'Incompatible rollback'):
                maintenance.install(source)
        self.assertEqual((code / 'value').read_text(), 'old code')
        self.assertEqual(json.loads((self.install / 'installation.json').read_text())['phase'], 'rolled-back')
    def test_success_preserves_previous_code(self):
        previous = self.transaction.commit([(self.source, self.destination)], self.install / 'previous')
        self.assertEqual((self.destination / 'value').read_text(), 'new code')
        self.assertEqual((previous / '0/value').read_text(), 'old code')
        self.assertFalse(self.transaction.recover())
    def test_interruption_after_old_directory_move_recovers(self):
        replace = os.replace
        def interrupted(source, target):
            if source == self.source: raise OSError('crash between directory replacements')
            return replace(source, target)
        with patch.object(maintenance.os, 'replace', side_effect=interrupted):
            with self.assertRaises(OSError): self.transaction.commit([(self.source, self.destination)], self.install / 'previous')
        self.assertFalse(self.destination.exists()); self.assertTrue(self.transaction.recover())
        self.assertEqual((self.destination / 'value').read_text(), 'old code')
        self.assertFalse(self.transaction.recover())
    def test_interruption_after_new_directory_move_recovers(self):
        with patch.object(self.transaction, 'reload', side_effect=OSError('crash before commit')):
            with self.assertRaises(OSError): self.transaction.commit([(self.source, self.destination)], self.install / 'previous')
        self.assertEqual((self.destination / 'value').read_text(), 'new code'); self.transaction.recover()
        self.assertEqual((self.destination / 'value').read_text(), 'old code')
    def test_mid_install_unit_failure_restores_code_and_managed_unit_together(self):
        unit = self.directory / 'unit.service'; unit.write_text('previous unit')
        staged_unit = self.install / 'new-unit.service'; staged_unit.write_text('new unit')
        transaction = maintenance.Replacement(self.install, [self.destination, unit], stop=lambda: None, reload=lambda: None)
        replace = os.replace
        def interrupted(source, target):
            if source == staged_unit: raise OSError('interrupted managed unit replacement')
            return replace(source, target)
        with patch.object(maintenance.os, 'replace', side_effect=interrupted):
            with self.assertRaises(OSError): transaction.commit([(self.source, self.destination), (staged_unit, unit)], self.install / 'previous')
        transaction.recover()
        self.assertEqual((self.destination / 'value').read_text(), 'old code')
        self.assertEqual(unit.read_text(), 'previous unit')

    def test_unmanaged_journal_destination_is_rejected(self):
        maintenance.atomic_json(self.transaction.file, {'version': 1, 'phase': 'replacing', 'paths': [
            {'source': str(self.source), 'destination': '/etc/passwd', 'backup': str(self.install / 'old'), 'existed': True}]})
        with self.assertRaisesRegex(RuntimeError, 'ownership'): self.transaction.recover()
        self.assertEqual(self.stops, [])
    def test_checksums_and_ownership_are_verified_before_restore(self):
        backup = self.directory / 'backup'; backup.mkdir(); payload = backup / 'payload'; payload.mkdir()
        (payload / 'file').write_text('snapshot')
        maintenance.atomic_json(backup / 'manifest.json', {'version': 1, 'contents': maintenance.inventory(payload)})
        archive = self.directory / 'snapshot.tar'
        with tarfile.open(archive, 'w') as stream: stream.add(payload, arcname='payload'); stream.add(backup / 'manifest.json', arcname='manifest.json')
        extracted = self.directory / 'extracted'; extracted.mkdir()
        maintenance.unpack_verified(archive, extracted)
        (payload / 'file').write_text('tampered')
        with tarfile.open(archive, 'w') as stream: stream.add(payload, arcname='payload'); stream.add(backup / 'manifest.json', arcname='manifest.json')
        other = self.directory / 'other'; other.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'checksum or ownership'): maintenance.unpack_verified(archive, other)
    def test_archive_path_and_link_escape_are_rejected_before_extraction(self):
        for name, target in [('../escape', None), ('payload/link', '/etc')]:
            archive = self.directory / 'unsafe.tar'
            with tarfile.open(archive, 'w') as stream:
                row = tarfile.TarInfo(name)
                if target: row.type = tarfile.SYMTYPE; row.linkname = target
                stream.addfile(row)
            with self.assertRaises(RuntimeError): maintenance.unpack_verified(archive, self.directory / 'empty')
        self.assertFalse((self.directory / 'escape').exists())
    @unittest.skipUnless(shutil.which('gpg'), 'GPG unavailable')
    def test_encrypted_backup_restore_holds_potentially_repeated_work(self):
        code = self.install / 'current'; (code / 'runtime').mkdir(parents=True)
        (code / 'runtime/durable-formats.json').write_text(json.dumps({'version': 1, 'backendReceipts': 2, 'botReceipts': 2, 'goalTransactions': 2, 'restoreHold': 1}))
        homes = [self.directory / 'backend', self.directory / 'bot', self.directory / 'configuration', self.directory / 'projects']
        for home in homes: home.mkdir()
        app = homes[0] / 'app'; app.mkdir(); (app / 'receipt').write_text('accepted-before-backup')
        profile = homes[0] / 'brave'; profile.mkdir(); (profile / 'state').write_text('profile retained')
        cache = homes[0] / '.cache/keyring-test'; cache.mkdir(parents=True)
        (cache / 'ordinary').write_text('regular keyring cache file')
        if os.name == 'posix' and hasattr(socket, 'AF_UNIX'):
            # A stopped keyring daemon can leave a non-restorable socket pathname.
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as endpoint:
                endpoint.bind(str(cache / 'control'))
        (homes[1] / 'state.json').write_text('bot checkpoint')
        external = self.directory / 'jdk-policy'; external.write_text('outside target is never replaced')
        os.symlink(str(external), homes[3] / 'jdk-policy-link')
        account = {'uid': os.getuid(), 'gid': os.getgid()}
        metadata = {'cos-backend': account, 'cos-discord': account, 'cos-control': {'gid': os.getgid()}}
        keyring = self.directory / 'test-keyring'; keyring.mkdir(mode=0o700)
        run = subprocess.run
        def local_process(args, **options):
            if args[0] == 'systemctl': return subprocess.CompletedProcess(args, 0)
            if args[0] == 'gpg':
                args = ['gpg', '--homedir', str(keyring), '--batch', '--pinentry-mode', 'loopback', '--passphrase-fd', '0', *args[1:]]
                options['input'] = b'public-test-fixture-passphrase\n'
                options['stdout'] = subprocess.PIPE; options['stderr'] = subprocess.PIPE
            return run(args, **options)
        output = self.directory / 'snapshot.gpg'
        with patch.object(maintenance, 'INSTALL', self.install), patch.object(maintenance, 'DATA', homes), \
             patch.object(maintenance, 'allowed_paths', return_value=[code, *homes]), \
             patch.object(maintenance, 'account_metadata', return_value=metadata), patch.object(maintenance.subprocess, 'run', side_effect=local_process):
            maintenance.backup(output)
            self.assertNotIn(b'accepted-before-backup', output.read_bytes())
            (app / 'receipt').write_text('work-after-backup-that-must-be-reconciled')
            maintenance.restore(output)
        self.assertEqual((app / 'receipt').read_text(), 'accepted-before-backup')
        self.assertTrue(json.loads((app / 'restore-hold.json').read_text())['held'])
        self.assertEqual((profile / 'state').read_text(), 'profile retained')
        self.assertEqual((cache / 'ordinary').read_text(), 'regular keyring cache file')
        self.assertFalse((cache / 'control').exists())
        self.assertEqual((homes[1] / 'state.json').read_text(), 'bot checkpoint')
        self.assertTrue((homes[3] / 'jdk-policy-link').is_symlink())
        self.assertEqual(os.readlink(homes[3] / 'jdk-policy-link'), str(external))
        self.assertEqual(external.read_text(), 'outside target is never replaced')
        self.assertEqual(maintenance.Replacement(self.install, [code, *homes]).read()['phase'], 'committed')

    def test_legacy_restored_code_cannot_start_before_reconciliation(self):
        backend = self.directory / 'backend'; app = backend / 'app'; app.mkdir(parents=True)
        (app / 'restore-hold.json').write_text(json.dumps({'version': 1, 'held': True}))
        (self.install / 'current').mkdir()
        with patch.object(maintenance, 'INSTALL', self.install), patch.object(maintenance, 'DATA', [backend]):
            with self.assertRaisesRegex(RuntimeError, 'Legacy restored code'): maintenance.boot_guard()
            self.assertEqual(maintenance.code_formats(self.install / 'current')['backendReceipts'], 1)

    def test_external_link_metadata_cannot_create_links_in_code_or_replace_nonempty_data(self):
        payload = self.directory / 'payload'; payload.mkdir()
        home = self.directory / 'backend'
        data = payload / str(home).lstrip('/'); data.mkdir(parents=True)
        target = data / 'link'; target.write_bytes(b'')
        name = target.relative_to(payload).as_posix()
        row = {'target': '/etc/java-fixture', 'uid': os.getuid(), 'gid': os.getgid()}
        manifest = {'version': 2, 'contents': maintenance.inventory(payload), 'externalLinks': {name: row}}
        with patch.object(maintenance, 'DATA', [home]):
            maintenance.external_link_rows(payload, manifest)
            target.write_text('must not be replaced')
            with self.assertRaisesRegex(RuntimeError, 'placeholder'):
                maintenance.restore_external_links(payload, manifest)
            self.assertEqual(target.read_text(), 'must not be replaced')
            target.write_bytes(b'')
            with patch.object(maintenance, 'DATA', [self.directory / 'other']):
                with self.assertRaisesRegex(RuntimeError, 'not owned'):
                    maintenance.restore_external_links(payload, manifest)
        self.assertFalse(target.is_symlink())

    def test_inventory_refuses_symlinks_outside_backup(self):
        os.symlink('/etc/passwd', self.source / 'escape')
        with self.assertRaisesRegex(RuntimeError, 'outside'): maintenance.inventory(self.source)

    def test_boot_rollback_review_survives_another_reboot(self):
        with patch.object(self.transaction, 'reload', side_effect=OSError('crash before commit')):
            with self.assertRaises(OSError): self.transaction.commit([(self.source, self.destination)], self.install / 'previous')
        inactive = subprocess.CompletedProcess(['systemctl'], 3)
        with patch.object(maintenance, 'INSTALL', self.install), patch.object(maintenance, 'allowed_paths', return_value=[self.destination]), \
             patch.object(maintenance.subprocess, 'run', return_value=inactive), patch.object(maintenance, 'DATA', [self.directory / 'backend']):
            with self.assertRaisesRegex(RuntimeError, 'rolled back'): maintenance.boot_guard()
            self.assertEqual((self.destination / 'value').read_text(), 'old code')
            with self.assertRaisesRegex(RuntimeError, 'local review'): maintenance.boot_guard()
            maintenance.recover_locally()
            maintenance.boot_guard()
        self.assertFalse(self.transaction.read()['reviewRequired'])

if __name__ == '__main__': unittest.main()

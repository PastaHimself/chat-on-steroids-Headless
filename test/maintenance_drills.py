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
        self.assertEqual(maintenance.Replacement(self.install, [code, *homes]).read()['phase'], 'committed')

    def test_legacy_restored_code_cannot_start_before_reconciliation(self):
        backend = self.directory / 'backend'; app = backend / 'app'; app.mkdir(parents=True)
        (app / 'restore-hold.json').write_text(json.dumps({'version': 1, 'held': True}))
        (self.install / 'current').mkdir()
        with patch.object(maintenance, 'INSTALL', self.install), patch.object(maintenance, 'DATA', [backend]):
            with self.assertRaisesRegex(RuntimeError, 'Legacy restored code'): maintenance.boot_guard()
            self.assertEqual(maintenance.code_formats(self.install / 'current')['backendReceipts'], 1)

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

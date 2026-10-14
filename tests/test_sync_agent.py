import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from sync_agent import PendingPublication

class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'pending.json'
        self.pending=PendingPublication(self.path)
        self.snapshot={'products':[{'price':'42000'}]}
        self.pending.save({'id':'job-1'},self.snapshot,{'status':'partial'})
    def tearDown(self):self.tmp.cleanup()
    def test_network_failure_survives_restart(self):
        remote=Mock();remote.post.side_effect=ConnectionError()
        with self.assertRaises(ConnectionError):self.pending.flush(remote)
        self.assertTrue(self.path.exists())
        remote=Mock()
        self.assertTrue(PendingPublication(self.path).flush(remote))
        self.assertEqual(remote.post.call_args_list[0].args,('/api/internal/snapshot',self.snapshot))
        self.assertEqual(remote.post.call_args_list[1].args[1]['status'],'partial')
        self.assertFalse(self.path.exists())
    def test_failed_completion_keeps_snapshot_for_retry(self):
        remote=Mock();remote.post.side_effect=[{},ConnectionError()]
        with self.assertRaises(ConnectionError):self.pending.flush(remote)
        self.assertTrue(self.path.exists())
        remote.post.side_effect=None
        self.pending.flush(remote)
        self.assertEqual(remote.post.call_count,4)
    def test_no_pending_file_makes_no_request(self):
        self.path.unlink();remote=Mock()
        self.assertFalse(self.pending.flush(remote));remote.post.assert_not_called()

class CloudStorageTests(unittest.TestCase):
    def test_cache_and_outbox_use_persistent_volume(self):
        import os
        from unittest.mock import patch
        from catalog import Cache
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ,{'DATA_DIR':directory}):
                cache=Cache()
                self.assertEqual(cache.path,Path(directory)/'catalog.sqlite3')
                pending=PendingPublication(cache.path.parent/'pending_publication.json')
                pending.save({'id':'cloud-job'},cache.snapshot(),{'status':'succeeded'})
                self.assertTrue((Path(directory)/'pending_publication.json').exists())

import json
import os
import sys
import types
import tempfile
import unittest


fake_bilibili_api = types.ModuleType("bilibili_api")
fake_bilibili_api.video = object()
fake_bilibili_api.comment = object()
fake_bilibili_api.sync = object()


class FakeCredential:
    pass


fake_bilibili_api.Credential = FakeCredential
sys.modules["bilibili_api"] = fake_bilibili_api

from worker_crawler import load_latest_credential


class TestLoadLatestCredential(unittest.TestCase):
    def test_missing_directory_returns_none(self):
        missing_dir = os.path.join(tempfile.gettempdir(), "bccavt_missing_credentials")
        if os.path.isdir(missing_dir):
            self.skipTest(f"测试目录已存在: {missing_dir}")
        self.assertIsNone(load_latest_credential(missing_dir))

    def test_loads_latest_credential_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            older_path = os.path.join(temp_dir, "bilibili_credential_20240101.json")
            latest_path = os.path.join(temp_dir, "bilibili_credential_20240102.json")

            with open(older_path, "w", encoding="utf-8") as older_file:
                json.dump({"sessdata": "older", "bili_jct": "older", "buvid3": "older", "dedeuserid": "older"}, older_file)

            with open(latest_path, "w", encoding="utf-8") as latest_file:
                json.dump({"sessdata": "latest", "bili_jct": "latest", "buvid3": "latest", "dedeuserid": "latest"}, latest_file)

            credential = load_latest_credential(temp_dir)

            self.assertIsNotNone(credential)
            self.assertEqual("latest", credential.sessdata)
            self.assertEqual("latest", credential.bili_jct)
            self.assertEqual("latest", credential.buvid3)
            self.assertEqual("latest", credential.dedeuserid)


if __name__ == "__main__":
    unittest.main()

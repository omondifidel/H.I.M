"""Where uploaded PDFs live. "local" uses the server's disk (lost when a free host restarts);
"s3" uses any S3-compatible bucket (Cloudflare R2, Backblaze B2, Supabase Storage, MinIO...) and is permanent.
Callers only ever use put_file / exists / delete / response / read_bytes."""
import shutil
from pathlib import Path
from typing import Optional

from fastapi.responses import FileResponse, Response, StreamingResponse

from app.core.config import settings


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        path = self.root / key
        if not path.exists() and key.startswith("pdf/"):  # PDFs saved by the first version sat directly in the folder
            legacy = self.root / key[4:]
            if legacy.exists():
                return legacy
        return path

    def put_file(self, key: str, source: Path) -> None:
        target = self.root / key
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def response(self, key: str, media_type: str) -> Response:
        return FileResponse(self._path(key), media_type=media_type)

    def read_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()


class S3Storage:
    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str, region: str, client=None):
        self.bucket = bucket
        if client is None:
            import boto3
            from botocore.config import Config

            client = boto3.client("s3", endpoint_url=endpoint or None, aws_access_key_id=access_key,
                                  aws_secret_access_key=secret_key, region_name=region,
                                  config=Config(signature_version="s3v4", retries={"max_attempts": 3}))
        self.client = client

    def put_file(self, key: str, source: Path) -> None:
        self.client.upload_file(str(source), self.bucket, key)
        source.unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:  # a missing object raises a 404 ClientError
            return False

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            pass

    def response(self, key: str, media_type: str) -> Response:
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        return StreamingResponse(obj["Body"].iter_chunks(256 * 1024), media_type=media_type,
                                 headers={"Content-Length": str(obj["ContentLength"])})

    def read_bytes(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()


_storage: Optional[object] = None


def get_storage():
    global _storage
    if _storage is None:
        if settings.storage_backend == "s3":
            if not (settings.s3_bucket and settings.s3_access_key and settings.s3_secret_key):
                raise RuntimeError("STORAGE_BACKEND=s3 needs S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY")
            _storage = S3Storage(settings.s3_endpoint, settings.s3_bucket, settings.s3_access_key,
                                 settings.s3_secret_key, settings.s3_region)
        else:
            _storage = LocalStorage(settings.storage_dir)
    return _storage

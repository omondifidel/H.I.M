import datetime as dt
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TranscriptionCreate(BaseModel):
    filename: str
    size: int = Field(gt=0)
    title: Optional[str] = None
    language: Optional[str] = None  # "en", "sw", ... or None to detect
    vocabulary: str = ""
    bible: bool = True
    mixed: bool = False  # English and Kiswahili mixed in the same sermon


class CompleteIn(BaseModel):
    parts: int = Field(gt=0)


class TranscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    original_name: str
    size: int
    language: Optional[str] = None
    mixed: bool = False
    status: str
    note: str = ""
    error: str = ""
    progress: int = 0
    chunks_total: int = 0
    chunks_done: int = 0
    duration: float = 0.0
    has_audio: bool = False
    created_at: dt.datetime
    updated_at: dt.datetime
    finished_at: Optional[dt.datetime] = None


class UploadStatus(BaseModel):
    id: str
    status: str
    received_parts: list[int]
    part_size: int


class Segment(BaseModel):
    start: float
    end: float
    text: str
    low: bool = False
    para: Optional[bool] = None  # True = a paragraph starts here (set once you have edited the layout)


class Paragraph(Segment):
    first: int
    last: int


class SermonNote(BaseModel):
    id: str = Field(max_length=40)
    time: float = Field(ge=0)  # seconds into the recording
    body: str = Field(max_length=20000)


class TranscriptOut(BaseModel):
    id: str
    title: str
    duration: float
    segments: list[Segment]
    paragraphs: list[Paragraph]
    notes: list[SermonNote] = []


class TranscriptPatch(BaseModel):
    title: Optional[str] = None
    segments: Optional[list[Segment]] = None
    notes: Optional[list[SermonNote]] = Field(default=None, max_length=2000)


class EngineInfo(BaseModel):
    configured: bool
    engine: str
    max_audio_mb: int
    part_size: int

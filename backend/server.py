from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ===== Models =====
class GenerateRequest(BaseModel):
    image1_base64: str  # base64 only (no data: prefix)
    image2_base64: str
    prompt: str


class Creation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    prompt: str
    result_image_base64: str
    mime_type: str = "image/png"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CreationSummary(BaseModel):
    id: str
    prompt: str
    result_image_base64: str
    mime_type: str
    created_at: datetime


# ===== Helpers =====
def _strip_data_url(b64: str) -> str:
    if b64.startswith("data:"):
        # data:image/png;base64,XXXX
        return b64.split(",", 1)[-1]
    return b64


# ===== Routes =====
@api_router.get("/")
async def root():
    return {"message": "Star In Your Own Scene API"}


@api_router.post("/generate-photo", response_model=CreationSummary)
async def generate_photo(payload: GenerateRequest):
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY not configured")

    img1 = _strip_data_url(payload.image1_base64)
    img2 = _strip_data_url(payload.image2_base64)
    prompt = payload.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    session_id = str(uuid.uuid4())
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message="You are an expert photo editor that creates photorealistic composite images.",
    )
    chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(
        modalities=["image", "text"]
    )

    msg = UserMessage(
        text=prompt,
        file_contents=[ImageContent(img1), ImageContent(img2)],
    )

    try:
        text, images = await chat.send_message_multimodal_response(msg)
    except Exception as e:
        logger.exception("Image generation failed")
        raise HTTPException(status_code=502, detail=f"Image generation failed: {str(e)}")

    if not images:
        raise HTTPException(
            status_code=502,
            detail=f"Model did not return an image. Response: {text[:200] if text else ''}",
        )

    first = images[0]
    result_b64 = first.get("data", "")
    mime_type = first.get("mime_type", "image/png")

    creation = Creation(
        prompt=prompt,
        result_image_base64=result_b64,
        mime_type=mime_type,
    )
    doc = creation.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.creations.insert_one(doc)

    return CreationSummary(**creation.model_dump())


@api_router.get("/creations", response_model=List[CreationSummary])
async def list_creations():
    docs = await db.creations.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    out: List[CreationSummary] = []
    for d in docs:
        if isinstance(d.get("created_at"), str):
            d["created_at"] = datetime.fromisoformat(d["created_at"])
        out.append(CreationSummary(**d))
    return out


@api_router.delete("/creations/{creation_id}")
async def delete_creation(creation_id: str):
    res = await db.creations.delete_one({"id": creation_id})
    return {"deleted": res.deleted_count}


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

"""
FastAPI entry point for the AI Question Paper Generator service.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import generate, questions, validate, units, analyze_pdf

app = FastAPI(
    title="AI Question Paper Generator",
    description="RAG-powered question paper generation using LangChain + Google Gemini",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────
app.include_router(generate.router)

app.include_router(questions.router)
app.include_router(validate.router)
app.include_router(units.router)
app.include_router(analyze_pdf.router)


# ── Health Check ──────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "ai-question-paper-generator"}


# ── Run with: uvicorn app:app --reload --port 8000 ───────────────
if __name__ == "__main__":
    import uvicorn
    from config import HOST, PORT

    uvicorn.run("app:app", host=HOST, port=PORT, reload=True)

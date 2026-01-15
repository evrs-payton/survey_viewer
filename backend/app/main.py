from __future__ import annotations

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import assignments, bands, manual_regions, signals


def create_app() -> FastAPI:
    app = FastAPI(title="RF Spectrum Backend")

    # Support comma-separated origins in FRONTEND_ORIGIN (e.g., "http://localhost:3001,http://localhost:3000")
    origins_env = os.getenv("FRONTEND_ORIGIN", "*")
    allow_origins = [o.strip() for o in origins_env.split(",")] if origins_env else ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "X-Time-Start",
            "X-Time-End",
            "X-Freq-Start",
            "X-Freq-End",
        ],
    )

    app.include_router(bands.router)
    app.include_router(assignments.router)
    app.include_router(manual_regions.router)
    app.include_router(signals.router)

    return app


app = create_app()

"""Google Gemini integration (server-side only; the API key never reaches the browser)."""
from __future__ import annotations

import json
import logging
import re
import threading
from collections.abc import Iterator
from typing import Any, Protocol

from app.config import get_settings

logger = logging.getLogger(__name__)


class LLMUnavailableError(RuntimeError):
    """Raised when Gemini is not configured or the API call fails."""


class LLM(Protocol):
    name: str

    def generate(self, prompt: str, *, system: str | None = None, json_mode: bool = False) -> str: ...

    def stream(self, prompt: str, *, system: str | None = None) -> Iterator[str]: ...


def _friendly_error(exc: Exception) -> str:
    msg = str(exc)
    low = msg.lower()
    if "api key" in low or "api_key" in low or "permission" in low or "401" in low or "403" in low:
        return "Gemini rejected the API key. Check GEMINI_API_KEY in your .env file."
    if "429" in low or "quota" in low or "resource_exhausted" in low:
        return "Gemini rate limit or quota exceeded. Wait a minute and try again."
    if "404" in low and "model" in low:
        return f"Gemini model not found. Check GEMINI_MODEL in your .env file ({get_settings().gemini_model})."
    return f"Gemini request failed: {msg[:300]}"


class GeminiLLM:
    def __init__(self, api_key: str, model: str, temperature: float = 0.2):
        from google import genai

        self.name = model
        self.temperature = temperature
        self._client = genai.Client(api_key=api_key)

    def _config(self, system: str | None, json_mode: bool):
        from google.genai import types

        return types.GenerateContentConfig(
            system_instruction=system,
            temperature=self.temperature,
            response_mime_type="application/json" if json_mode else None,
        )

    def generate(self, prompt: str, *, system: str | None = None, json_mode: bool = False) -> str:
        try:
            resp = self._client.models.generate_content(
                model=self.name, contents=prompt, config=self._config(system, json_mode)
            )
        except Exception as exc:
            logger.warning("Gemini generate failed: %s", exc.__class__.__name__)
            raise LLMUnavailableError(_friendly_error(exc)) from exc
        text = resp.text or ""
        if not text.strip():
            raise LLMUnavailableError("Gemini returned an empty response (it may have been blocked by safety filters).")
        return text

    def stream(self, prompt: str, *, system: str | None = None) -> Iterator[str]:
        try:
            for chunk in self._client.models.generate_content_stream(
                model=self.name, contents=prompt, config=self._config(system, False)
            ):
                if chunk.text:
                    yield chunk.text
        except Exception as exc:
            logger.warning("Gemini stream failed: %s", exc.__class__.__name__)
            raise LLMUnavailableError(_friendly_error(exc)) from exc


_llm: LLM | None = None
_override = False
_lock = threading.Lock()


def get_llm() -> LLM:
    """Return the configured LLM or raise LLMUnavailableError with an actionable message."""
    global _llm
    if _llm is not None:
        return _llm
    s = get_settings()
    if not s.gemini_configured:
        raise LLMUnavailableError(
            "Gemini API key is not configured. Add GEMINI_API_KEY to your .env file "
            "(free key: https://aistudio.google.com/apikey) and restart the backend."
        )
    with _lock:
        if _llm is None:
            _llm = GeminiLLM(s.gemini_api_key.strip(), s.gemini_model, s.gemini_temperature)
    return _llm


def llm_available() -> bool:
    return _llm is not None or get_settings().gemini_configured


def set_llm(llm: LLM | None) -> None:
    """Override the LLM (tests)."""
    global _llm
    _llm = llm


_JSON_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_json(text: str) -> Any:
    """Parse JSON from an LLM response, tolerating markdown code fences and leading prose."""
    cleaned = _JSON_FENCE.sub("", text.strip()).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(open_c), cleaned.rfind(close_c)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMUnavailableError("Gemini returned malformed JSON. Please try again.")

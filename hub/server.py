"""
Awaaz hub service — runs on the Mac next to the local nwaku node.

  GET  /health          -> which models are configured and loaded
  GET  /hub-info        -> the nwaku WebSocket multiaddr phones should dial
  POST /anon            -> voice or text -> anonymised text (audio discarded)
  POST /voice           -> base64 audio -> {text, tags}  (Parakeet + Qwen)
  POST /transcribe-b64  -> base64 audio -> {text}         (Parakeet)
  POST /transcribe      -> multipart audio -> {text}      (Parakeet)
  POST /structure       -> transcript -> neighbourhood request card (Qwen)

Both models start loading in the background at startup, so the first voice
message isn't slow; requests that arrive earlier just wait for the load.
"""
import base64
import json
import os
import re
import tempfile
import threading
import time
import urllib.request

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

STT_MODEL = os.environ.get("AWAAZ_STT_MODEL", "mlx-community/parakeet-tdt-0.6b-v2")
LLM_MODEL = os.environ.get("AWAAZ_LLM_MODEL", "mlx-community/Qwen3.5-4B-4bit")
NWAKU_REST = os.environ.get("AWAAZ_NWAKU_REST", "http://127.0.0.1:8645")
NWAKU_WS_PORT = int(os.environ.get("AWAAZ_NWAKU_WS_PORT", "8000"))

FAMILY_TAGS = ["medicine", "meal", "walk", "unwell"]

app = FastAPI(title="Awaaz hub")


class Model:
    """Lazily loaded model with its own lock and a visible load state."""

    def __init__(self, name, loader):
        self.name = name
        self._loader = loader
        self._lock = threading.Lock()
        self.value = None
        self.state = "not loaded"  # not loaded | loading | ready | error: ...
        self.load_seconds = None

    def get(self):
        with self._lock:
            if self.value is None:
                self.state = "loading"
                t = time.time()
                try:
                    self.value = self._loader(self.name)
                except Exception as e:
                    self.state = f"error: {e}"
                    raise
                self.load_seconds = round(time.time() - t, 1)
                self.state = "ready"
        return self.value

    def info(self):
        return {"model": self.name, "state": self.state, "loadSeconds": self.load_seconds}


def _load_stt(name):
    from parakeet_mlx import from_pretrained

    return from_pretrained(name)


def _load_llm(name):
    from mlx_lm import load

    return load(name)


STT = Model(STT_MODEL, _load_stt)
LLM = Model(LLM_MODEL, _load_llm)
# MLX streams are per-thread: a model loaded on one thread can't run on
# another ("There is no Stream(cpu, 1) in current thread"). So every load and
# every inference runs on this one dedicated thread, which also serialises them.
from concurrent.futures import ThreadPoolExecutor  # noqa: E402

_mlx = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")


def on_mlx(fn, *args):
    return _mlx.submit(fn, *args).result()


@app.on_event("startup")
def warm_up():
    for m in (STT, LLM):
        _mlx.submit(_try, m.get)


def _try(fn):
    try:
        fn()
    except Exception as e:
        print(f"warm-up failed: {e}")


@app.get("/health")
def health():
    # "service" lets phones recognise a hub when they scan the local network.
    return {"ok": True, "service": "awaaz-hub", "stt": STT.info(), "llm": LLM.info()}


@app.get("/hub-info")
def hub_info(host: str = "127.0.0.1"):
    """Phones pass the host they reached us on, so the multiaddr matches it."""
    try:
        with urllib.request.urlopen(f"{NWAKU_REST}/debug/v1/info", timeout=3) as r:
            info = json.load(r)
    except Exception as e:
        raise HTTPException(503, f"nwaku not reachable: {e}")
    peer_id = info["listenAddresses"][0].rsplit("/p2p/", 1)[-1]
    return {
        "peerId": peer_id,
        "multiaddr": f"/ip4/{host}/tcp/{NWAKU_WS_PORT}/ws/p2p/{peer_id}",
        "clusterId": 66,
        "numShardsInCluster": 1,
    }


def _transcribe_bytes(data: bytes, ext: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(data)
        path = f.name
    try:
        return on_mlx(lambda: STT.get().transcribe(path).text.strip())
    finally:
        os.unlink(path)


def _ask_json(prompt: str, max_tokens: int = 200):
    """Run Qwen on a prompt and parse the first JSON value in its answer."""
    from mlx_lm import generate

    def run():
        model, tokenizer = LLM.get()
        chat = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            add_generation_prompt=True,
            tokenize=False,
            enable_thinking=False,
        )
        return generate(model, tokenizer, prompt=chat, max_tokens=max_tokens)

    out = on_mlx(run)
    m = re.search(r"[\[{].*[\]}]", out, re.S)
    if not m:
        raise ValueError(f"model returned no JSON: {out[:200]}")
    return json.loads(m.group(0))


TAG_PROMPT = """An elderly parent left this short voice message for their child.
Which of these things does the parent say happened TODAY?
  "medicine": took their medicine / tablets
  "meal": ate a meal (breakfast, lunch, dinner, food)
  "walk": went for a walk / exercise
  "unwell": feels unwell, sick, pain, dizzy, tired, fever, or any health worry
Return ONLY a JSON array of the matching keys, e.g. ["medicine","meal"], or [] if none.
Message: """

KEYWORDS = {
    "medicine": r"\b(medicine|medicines|tablet|tablets|pill|pills)\b",
    "meal": r"\b(breakfast|lunch|dinner|ate|eaten|food|meal)\b",
    "walk": r"\b(walk|walked|walking|exercise)\b",
    "unwell": r"\b(not feeling well|unwell|sick|pain|dizzy|fever|headache|weak)\b",
}


def _tags_for(text: str):
    """Qwen picks tags; simple keywords are the fallback if it fails."""
    if not text:
        return [], "none"
    try:
        tags = _ask_json(TAG_PROMPT + text, max_tokens=40)
        if isinstance(tags, list):
            return [t for t in FAMILY_TAGS if t in tags], "qwen"
    except Exception as e:
        print(f"tagging fell back to keywords: {e}")
    low = text.lower()
    return [t for t, rx in KEYWORDS.items() if re.search(rx, low)], "keywords"


class AudioIn(BaseModel):
    audio: str  # base64
    ext: str = ".m4a"


@app.post("/voice")
def voice(body: AudioIn):
    """Family voice message: transcript plus auto-detected check-in tags."""
    t = time.time()
    text = _transcribe_bytes(base64.b64decode(body.audio), body.ext)
    t_stt = time.time()
    tags, source = _tags_for(text)
    return {
        "text": text,
        "tags": tags,
        "tagSource": source,
        "ms": {"stt": round((t_stt - t) * 1000), "tags": round((time.time() - t_stt) * 1000)},
    }


@app.post("/transcribe-b64")
def transcribe_b64(body: AudioIn):
    """JSON variant for the app: Expo's fetch can't send RN-style file parts."""
    return {"text": _transcribe_bytes(base64.b64decode(body.audio), body.ext)}


@app.post("/transcribe")
def transcribe(audio: UploadFile = File(...)):
    suffix = os.path.splitext(audio.filename or "")[1] or ".m4a"
    return {"text": _transcribe_bytes(audio.file.read(), suffix)}


GUARD_PROMPT = """You protect the anonymity of someone posting in an anonymous community room
(college, workplace, housing society). Rewrite their message so it cannot identify
THEM or attack a specific PERSON, while keeping the issue and its meaning.

Rules:
- Replace every person's name with a role ("a warden", "a classmate", "a friend").
- Remove phone numbers, emails, flat/room/roll numbers, exact times and other details
  that identify the speaker. Keep shared places ("the canteen", "Block C").
- Do NOT add facts. Keep it short, first person, plain English.
- removed: SHORT TYPES ONLY, never the removed words themselves,
  e.g. ["a name", "a phone number", "a room number"].
- category: one of "safety","harassment","facilities","food","health","money","work","idea","other".
- personal_attack: true if the message mainly insults or accuses an identifiable individual.

Return ONLY JSON: {"text": "...", "removed": [...], "category": "...", "personal_attack": false}
Message: """

RETRY_PROMPT = """Rewrite this message so it identifies nobody: replace every person's name with
a role (e.g. "a warden"), remove phone numbers, emails and room numbers. Keep the meaning.
Reply with ONLY the rewritten message, nothing else.
Message: """

# Deterministic safety net, applied AFTER the AI on every post.
_TITLE = r"(?:Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Madam|Shri|Smt)\.?"
_NAME = r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"
SCRUBS = [
    (r"[\w.+-]+@[\w-]+\.[\w.]+", "[removed]", "an email address"),
    (r"\+?\d[\d\s-]{7,}\d", "[removed]", "a phone number"),
    (r"\b(?:room|flat|roll|hostel room|apartment|apt)\s*(?:no\.?|number)?\s*#?\d+[A-Za-z]?\b", "my room", "a room number"),
    (rf"\b{_TITLE}\s+{_NAME}", "someone", "a name"),
    (rf"\b(?:I am|I'm|my name is|this is)\s+{_NAME}\b", "I am a resident", "your name"),
]

PHONE_RX = r"\+?\d[\d\s-]{7,}\d"
EMAIL_RX = r"[\w.+-]+@[\w-]+\.[\w.]+"


def _scrub(text: str):
    """Rule-based scrub; returns (text, list of removed types)."""
    removed = []
    for rx, repl, label in SCRUBS:
        new = re.sub(rx, repl, text, flags=re.IGNORECASE if label != "a name" else 0)
        if new != text:
            removed.append(label)
            text = new
    return text, removed


def _salvage_text(raw: str):
    """Pull "text" out of JSON the model didn't finish (cut off mid-answer)."""
    m = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', raw)
    if not m:
        return None
    try:
        return json.loads(f'"{m.group(1)}"')
    except json.JSONDecodeError:
        return m.group(1)


def _generate(prompt: str, max_tokens: int) -> str:
    from mlx_lm import generate

    def run():
        model, tokenizer = LLM.get()
        chat = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            add_generation_prompt=True,
            tokenize=False,
            enable_thinking=False,
        )
        return generate(model, tokenizer, prompt=chat, max_tokens=max_tokens)

    return on_mlx(run)


REMOVED_TYPES = {"a name", "your name", "a phone number", "an email address", "a room number",
                 "an address", "a time", "a date", "an id number", "identifying details"}


def _removed_types(items, original: str):
    """The guard's "removed" list as types only: the model sometimes echoes the words it removed."""
    out = []
    for item in items:
        t = item.strip().lower()
        if t not in REMOVED_TYPES:
            if re.search(r"\d", item):
                t = "a number"
            elif re.search(r"[\w.+-]+@", item):
                t = "an email address"
            elif item.strip() and item.strip().lower() in original.lower() and item.strip()[:1].isupper():
                t = "a name"
            elif not t.startswith(("a ", "an ", "your ")) or len(t.split()) > 4:
                t = "identifying details"
        if t not in out:
            out.append(t)
    return out


def _guard(text: str):
    """Qwen anonymity guard, a plain-rewrite retry, then a rule-based scrub on top."""
    if not text.strip():
        return {"text": "", "removed": [], "category": "other", "personal_attack": False, "guard": "none"}
    result = None
    try:
        raw = _generate(GUARD_PROMPT + text, max_tokens=500)
        m = re.search(r"\{.*\}", raw, re.S)
        out = None
        if m:
            try:
                out = json.loads(m.group(0))
            except json.JSONDecodeError:
                out = None
        if isinstance(out, dict) and isinstance(out.get("text"), str):
            result = {
                "text": out["text"].strip(),
                "removed": [str(r) for r in out.get("removed", [])][:8],
                "category": str(out.get("category", "other")),
                "personal_attack": bool(out.get("personal_attack", False)),
                "guard": "qwen",
            }
        else:
            salvaged = _salvage_text(raw)
            if salvaged:
                print("guard: salvaged text from incomplete JSON", flush=True)
                result = {"text": salvaged.strip(), "removed": ["identifying details"], "category": "other",
                          "personal_attack": False, "guard": "qwen"}
    except Exception as e:
        print(f"guard: first pass failed: {e}", flush=True)
    if result is None:
        try:
            rewritten = _generate(RETRY_PROMPT + text, max_tokens=300).strip().strip('"')
            if rewritten:
                print("guard: used plain rewrite retry", flush=True)
                result = {"text": rewritten, "removed": ["identifying details"], "category": "other",
                          "personal_attack": False, "guard": "qwen"}
        except Exception as e:
            print(f"guard: retry failed: {e}", flush=True)
    if result is None:
        result = {"text": text, "removed": [], "category": "other", "personal_attack": False, "guard": "regex"}
    # Always apply the deterministic scrub on top of whatever the AI produced.
    scrubbed, extra = _scrub(result["text"])
    result["text"] = scrubbed
    for label in extra:
        if label not in result["removed"]:
            result["removed"].append(label)
    result["removed"] = _removed_types(result["removed"], text)
    return result


class AnonIn(BaseModel):
    audio: str | None = None  # base64; transcribed then discarded
    ext: str = ".m4a"
    text: str | None = None


@app.post("/anon")
def anon(body: AnonIn):
    """Anonymous post: speech -> text (audio never stored or forwarded) -> anonymity guard."""
    t0 = time.time()
    original = body.text or ""
    audio_bytes = 0
    if body.audio:
        raw = base64.b64decode(body.audio)
        audio_bytes = len(raw)
        original = _transcribe_bytes(raw, body.ext)
    t1 = time.time()
    result = _guard(original)
    # Diagnostics only: sizes and timings, never the words themselves.
    print(
        f"anon: audio={audio_bytes}B transcript={len(original)}ch "
        f"stt={t1 - t0:.1f}s guard={time.time() - t1:.1f}s via={result['guard']}",
        flush=True,
    )
    result["original"] = original  # returned only to the poster's own device, for the preview
    return result


class StructureIn(BaseModel):
    text: str


CARD_PROMPT = """You turn a spoken neighbourhood help request into JSON.
Return ONLY a JSON object with these keys:
  "need": one of "evacuation","medical","food","water","shelter","rescue","power","other"
  "people": integer number of people affected (1 if unclear)
  "place": short place hint from the text, or "" if none
  "urgency": one of "high","medium","low"
  "summary": one short sentence restating the request
Request: """


@app.post("/structure")
def structure(body: StructureIn):
    try:
        card = _ask_json(CARD_PROMPT + body.text)
    except Exception as e:
        raise HTTPException(502, str(e))
    if not isinstance(card, dict):
        raise HTTPException(502, f"expected a JSON object, got: {card}")
    return card


"""Does meaning search find the right passage, in English and Kiswahili, and stay quiet when nothing fits?
Uses the real Gemini embeddings (GEMINI_API_KEY) and the same cosine distance and cut-off as pgvector search.
Run from backend/:  python scripts/eval_meaning.py
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from app.modules.search import vectors  # noqa: E402

PASSAGES = {
    "trust": "When the storm comes and you lose your job, do not let go of God. He is faithful even when you cannot see the way.",
    "forgive": "Forgive the one who hurt you, as Christ forgave you. Bitterness is a prison you lock yourself into.",
    "money": "Make a budget before the month begins, and give the first tenth back to God before you spend on anything else.",
    "marriage": "Husbands, love your wives; wives, honour your husbands. A marriage is built in small daily kindnesses.",
    "prayer": "Pray without ceasing. Wake early, before the noise of the day, and speak to your Father in secret.",
    "healing": "By his stripes we are healed. Lay hands on the sick and believe that God still restores the body.",
    "garden": "Water the basil and mint in the morning, and keep the soil moist but never soaked.",
    "youth": "Young people, do not let anyone look down on you because you are young; set an example in speech and conduct.",
    "imani_sw": "Imani ni kuwa na hakika ya mambo yatarajiwayo. Mungu hatakuacha wala hatakupungukia kamwe.",
    "msamaha_sw": "Samehe kama Kristo alivyokusamehe. Usilale na hasira moyoni mwako.",
    "fasting": "Fasting humbles the flesh. For three days the church will fast and seek God's direction for the year.",
    "giving": "God loves a cheerful giver. Bring your offering with joy, not because you are forced.",
}
QUERIES = [  # (query, the passage(s) it should find first - English or Kiswahili both count - or None)
    ("trusting God in hard times", "trust"), ("what to do when you are made redundant", "trust"),
    ("letting go of anger at someone", "forgive"), ("tithing and managing my salary", "money"),
    ("how to keep a happy marriage", "marriage"), ("waking up early to talk to God", "prayer"),
    ("does God still heal sickness", "healing"), ("looking after herbs", "garden"),
    ("advice for teenagers", "youth"), ("kuamini Mungu wakati wa shida", {"trust", "imani_sw"}),
    ("faith that God will not abandon me", "imani_sw"), ("jinsi ya kusamehe", {"forgive", "msamaha_sw"}),
    ("going without food to hear from God", "fasting"), ("giving offerings happily", "giving"),
    ("forgiveness", {"forgive", "msamaha_sw"}), ("ndoa yenye furaha", "marriage"),
    ("football results from last night", None), ("how to change a car tyre", None),
    ("bitcoin price prediction", None), ("best pizza in Nairobi", None),
]


def cos_distance(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return 1 - dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def main():
    ids = list(PASSAGES)
    docs = vectors.embed([PASSAGES[i] for i in ids], "RETRIEVAL_DOCUMENT")
    qs = vectors.embed([q for q, _ in QUERIES], "RETRIEVAL_QUERY")
    if not docs or not qs:
        sys.exit("Gemini did not answer: check GEMINI_API_KEY")
    hits = quiet = 0
    for (q, want), qv in zip(QUERIES, qs):
        ranked = sorted((cos_distance(qv, dv), i) for i, dv in zip(ids, docs))
        best_d, best = ranked[0]
        found = best if best_d <= vectors.MAX_DISTANCE else None
        ok = found in want if isinstance(want, set) else found == want
        hits += ok and want is not None
        quiet += ok and want is None
        print(f"{'OK ' if ok else 'XX '} {q!r:48} -> {found or '(nothing)':10} distance {best_d:.3f}  (want {' or '.join(sorted(want)) if isinstance(want, set) else want or 'nothing'})")
    on_topic = sum(1 for _, w in QUERIES if w)
    print(f"\nfound the right passage first: {hits}/{on_topic}   stayed quiet off-topic: {quiet}/{len(QUERIES) - on_topic}"
          f"   cut-off {vectors.MAX_DISTANCE}")


if __name__ == "__main__":
    main()

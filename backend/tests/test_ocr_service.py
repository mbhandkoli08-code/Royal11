"""Regression tests for the OCR parsing/matching pure functions.

These do NOT hit Google Cloud Vision — they exercise the amount/UTR/timestamp
extraction + match logic that turns raw OCR text into the Admin's advisory
"Matches" / "Review carefully" verdict.
"""
from app.ocr_service import parse_and_match


GPAY = (
    "Google Pay\n₹500\nPaid to Rahul Sharma\n12 Jan 2026, 3:45 pm\n"
    "UPI transaction ID 123456789012\nCompleted"
)


def test_full_match():
    r = parse_and_match(GPAY, 500, "123456789012", "2026-01-12T10:00:00+00:00")
    assert r["match"]["amount"] is True
    assert r["match"]["utr"] is True
    assert r["match"]["overall"] == "match"
    assert r["extracted"]["amount_inr"] == 500


def test_amount_mismatch_is_review():
    r = parse_and_match(GPAY, 999, "123456789012", None)
    assert r["match"]["amount"] is False
    assert r["match"]["overall"] == "review"


def test_utr_mismatch_is_review():
    r = parse_and_match(GPAY, 500, "999999999999", None)
    assert r["match"]["utr"] is False
    assert r["match"]["overall"] == "review"


def test_empty_text_is_unknown():
    r = parse_and_match("", 500, "123456789012", None)
    assert r["match"]["overall"] == "unknown"


def test_rs_prefix_and_alnum_ref():
    txt = "Paytm\nRs. 1,250 paid\nUPI Ref No: ABX12KZ90\n05/02/2026"
    r = parse_and_match(txt, 1250, "abx12kz90", "2026-02-05T09:00:00+00:00")
    assert r["match"]["amount"] is True
    assert r["match"]["utr"] is True  # case-insensitive, punctuation-insensitive
    assert r["match"]["overall"] == "match"


def test_timestamp_advisory_does_not_block_match():
    # amount+utr match but screenshot date far from request date -> still 'match'
    txt = "₹500\nUPI transaction ID 123456789012\n01 Jan 2020"
    r = parse_and_match(txt, 500, "123456789012", "2026-01-12T10:00:00+00:00")
    assert r["match"]["timestamp"] is False
    assert r["match"]["overall"] == "match"

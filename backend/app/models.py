"""Pydantic request/response schemas + the enums that mirror the spec's role
hierarchy and ledger transaction types.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

# Standard Indian IFSC: 4 letters + '0' + 6 alphanumerics (e.g. SBIN0000001).
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


def _validate_ifsc(v: Optional[str], *, required: bool) -> Optional[str]:
    if v is None or str(v).strip() == "":
        if required:
            raise ValueError("IFSC is required")
        return None
    v = str(v).strip().upper()
    if not IFSC_RE.match(v):
        raise ValueError("Invalid IFSC — expected 4 letters + 0 + 6 alphanumerics, e.g. SBIN0000001")
    return v


def _validate_mobile(v: Optional[str]) -> Optional[str]:
    if v is None or str(v).strip() == "":
        return None
    v = str(v).strip()
    if not re.fullmatch(r"\d{10}", v):
        raise ValueError("Mobile number must be exactly 10 digits")
    return v


class Role(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ZONAL_MANAGER = "ZONAL_MANAGER"
    MANAGER = "MANAGER"
    ADMIN = "ADMIN"
    SUPPORT_HELPER = "SUPPORT_HELPER"
    PLAYER = "PLAYER"


class UserStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    SUSPENDED = "SUSPENDED"
    PENDING_VERIFICATION = "PENDING_VERIFICATION"


class TxnType(str, Enum):
    WELCOME_BONUS = "WELCOME_BONUS"
    DAILY_BONUS = "DAILY_BONUS"
    ACHIEVEMENT = "ACHIEVEMENT"
    SUPER_ADMIN_TO_MANAGER = "SUPER_ADMIN_TO_MANAGER"
    SUPER_ADMIN_TO_ZONAL = "SUPER_ADMIN_TO_ZONAL"
    ZONAL_TO_MANAGER = "ZONAL_TO_MANAGER"
    MANAGER_TO_ADMIN = "MANAGER_TO_ADMIN"
    ADMIN_GRANT = "ADMIN_GRANT"
    ADMIN_RECHARGE = "ADMIN_RECHARGE"
    CRYPTO_PURCHASE = "CRYPTO_PURCHASE"
    DEPOSIT_TOPUP = "DEPOSIT_TOPUP"
    REFERRAL_BONUS = "REFERRAL_BONUS"
    SALARY = "SALARY"
    INCENTIVE = "INCENTIVE"
    GAME_ENTRY = "GAME_ENTRY"
    GAME_REWARD = "GAME_REWARD"
    STORE_PURCHASE = "STORE_PURCHASE"
    FANTASY_ENTRY = "FANTASY_ENTRY"
    FANTASY_REWARD = "FANTASY_REWARD"
    BONUS_GRANT = "BONUS_GRANT"
    BONUS_RELEASE = "BONUS_RELEASE"
    BONUS_SPEND = "BONUS_SPEND"
    BONUS_FORFEIT = "BONUS_FORFEIT"
    REVERSAL = "REVERSAL"
    ADMIN_FLOAT_DEBIT = "ADMIN_FLOAT_DEBIT"
    ADMIN_CREDIT_TOPUP = "ADMIN_CREDIT_TOPUP"
    ADMIN_CREDIT_REPAYMENT = "ADMIN_CREDIT_REPAYMENT"


class TxnStatus(str, Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=80)
    referral_code: Optional[str] = Field(default=None, max_length=16)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class UserPublic(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: EmailStr
    display_name: str
    role: Role
    status: UserStatus
    created_at: datetime
    suspension_reason: Optional[str] = None
    referral_code: Optional[str] = None
    console_theme: Optional[str] = None
    rummy_theme: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# ---------------------------------------------------------------------------
# Wallet
# ---------------------------------------------------------------------------
class TransactionOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    type: TxnType
    amount: int
    balance_after: Optional[int] = None
    reason: Optional[str] = None
    actor_id: Optional[str] = None
    status: TxnStatus
    created_at: datetime


class WalletOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    balance: int
    updated_at: datetime


class WalletWithHistory(BaseModel):
    wallet: WalletOut
    transactions: List[TransactionOut]


# ---------------------------------------------------------------------------
# Admin hierarchy
# ---------------------------------------------------------------------------
class CreateManagerRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str
    authorized_quota: int = Field(default=0, ge=0)
    zonal_manager_id: Optional[str] = None  # SA may attach the Manager to a zone


class CreateZonalManagerRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str
    authorized_quota: int = Field(default=0, ge=0)


class UpdateManagerQuotaRequest(BaseModel):
    authorized_quota: int = Field(ge=0)


class SetMaxAdminsRequest(BaseModel):
    # null = unlimited
    max_admins_allowed: Optional[int] = Field(default=None, ge=0)


class PayrollRequest(BaseModel):
    weekly_salary_inr: int = Field(default=0, ge=0)
    incentive_target_inr: int = Field(default=0, ge=0)
    incentive_pct: float = Field(default=0, ge=0, le=100)


class WhatsappRequest(BaseModel):
    whatsapp_number: Optional[str] = Field(default=None, max_length=20)


class AdminCreationRequestCreate(BaseModel):
    """A Manager's request to create an Admin (needs ZM/SA approval)."""
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str
    player_capacity: int = Field(default=50, ge=0)


class ZonalFundManagerRequest(BaseModel):
    manager_id: str
    amount: int = Field(gt=0)
    request_id: Optional[str] = None


class ApproveRejectRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=200)


class FundManagerRequest(BaseModel):
    amount: int = Field(gt=0)
    reason: Optional[str] = None
    request_id: Optional[str] = None


class CreateAdminRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str
    manager_id: Optional[str] = None  # required if caller is SUPER_ADMIN; ignored/forced for MANAGER
    player_capacity: int = Field(default=50, ge=0)


class AllocateToAdminRequest(BaseModel):
    admin_id: str
    amount: int = Field(gt=0)
    request_id: Optional[str] = None


class GrantToPlayerRequest(BaseModel):
    player_id: str
    amount: int = Field(gt=0)
    reason: Optional[str] = None
    request_id: Optional[str] = None


class AssignPlayerRequest(BaseModel):
    player_id: str
    admin_id: str
    reason: Optional[str] = None


class ReverseTransactionRequest(BaseModel):
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# API keys (Super Admin)
# ---------------------------------------------------------------------------
class ApiKeyCreate(BaseModel):
    key: str = Field(min_length=8)
    provider: Optional[str] = None  # auto-detected if omitted


class ApiKeyTestRequest(BaseModel):
    """Ad-hoc test of a raw key before it's saved."""
    key: str = Field(min_length=8)
    provider: Optional[str] = None


class BalanceInfo(BaseModel):
    amount: float
    currency: str
    checked_at: str


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    provider: str
    key_last4: str
    added_by: Optional[str] = None
    created_at: str
    last_tested_at: Optional[str] = None
    last_test_status: str = "untested"
    last_test_message: Optional[str] = None
    balance_info: Optional[BalanceInfo] = None


class ApiKeyTestResult(BaseModel):
    provider: str
    status: str
    message: str
    balance_info: Optional[BalanceInfo] = None



# ---------------------------------------------------------------------------
# Coin top-up / deposits (Part 1)
# ---------------------------------------------------------------------------
class DepositRequestCreate(BaseModel):
    amount_inr: int = Field(gt=0)
    reference_note: str = Field(min_length=1, max_length=200)


class ConfirmDepositRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=200)


class AdminRechargeCreate(BaseModel):
    amount_inr: int = Field(gt=0)
    reference_note: str = Field(min_length=1, max_length=200)


class RejectDepositRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


class AutoApproveConfigInput(BaseModel):
    enabled: bool


# ---------------------------------------------------------------------------
# Collection bank account (Part 1b)
# ---------------------------------------------------------------------------
class BankAccountInput(BaseModel):
    account_holder_name: str = Field(min_length=1, max_length=120)
    account_number: str = Field(min_length=4, max_length=34)
    ifsc: str = Field(min_length=4, max_length=15)

    @field_validator("ifsc")
    @classmethod
    def _ifsc(cls, v):
        return _validate_ifsc(v, required=True)
    bank_name: str = Field(min_length=1, max_length=120)
    label: Optional[str] = Field(default=None, max_length=60)
    upi_id: Optional[str] = Field(default=None, max_length=100)
    is_active: bool = True


# ---------------------------------------------------------------------------
# Revenue split + settlement (Part 2)
# ---------------------------------------------------------------------------
class RevenueSplitRequest(BaseModel):
    revenue_split_super_admin_pct: int = Field(ge=0, le=100)


class SettleRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=200)


# ---------------------------------------------------------------------------
# Support / Complaints tickets (+ Support Helper staff role)
# ---------------------------------------------------------------------------
class TicketCategory(str, Enum):
    DEPOSIT = "DEPOSIT"
    WITHDRAWAL = "WITHDRAWAL"
    GAME = "GAME"
    ACCOUNT = "ACCOUNT"
    GENERAL = "GENERAL"


class TicketStatus(str, Enum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class TicketPriority(str, Enum):
    LOW = "LOW"
    NORMAL = "NORMAL"
    HIGH = "HIGH"


class SupportTicketCreate(BaseModel):
    category: TicketCategory = TicketCategory.GENERAL
    subject: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=3, max_length=2000)
    related_ref: Optional[str] = Field(default=None, max_length=80)


class SupportMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    internal: bool = False  # staff-only note; ignored/forced False for players


class TicketStatusUpdate(BaseModel):
    status: TicketStatus


class CreateSupportHelperRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1, max_length=80)


class SetHelperStatusRequest(BaseModel):
    status: UserStatus


# ---------------------------------------------------------------------------
# Player-owned profile: contact + payout details + marketing consent.
# Read of these sensitive fields is restricted to SUPER_ADMIN only.
# ---------------------------------------------------------------------------
class PlayerBankInput(BaseModel):
    account_holder_name: Optional[str] = Field(default=None, max_length=120)
    account_number: Optional[str] = Field(default=None, max_length=34)
    ifsc: Optional[str] = Field(default=None, max_length=15)
    bank_name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("ifsc")
    @classmethod
    def _ifsc(cls, v):
        return _validate_ifsc(v, required=False)


class MarketingConsent(BaseModel):
    marketing_opt_in: bool = False
    sms: bool = False
    whatsapp: bool = False
    push: bool = False


class PlayerProfileUpdate(BaseModel):
    mobile: Optional[str] = Field(default=None, max_length=20)
    upi_id: Optional[str] = Field(default=None, max_length=100)
    bank: Optional[PlayerBankInput] = None
    consent: Optional[MarketingConsent] = None

    @field_validator("mobile")
    @classmethod
    def _mobile(cls, v):
        return _validate_mobile(v)


# ---------------------------------------------------------------------------
# Admin Credit Line (overdraft-style float credit set by the upline Manager)
# ---------------------------------------------------------------------------
class SetCreditLimitRequest(BaseModel):
    credit_limit: int = Field(ge=0)
    note: Optional[str] = Field(default=None, max_length=200)


class CreditRequestCreate(BaseModel):
    amount: int = Field(gt=0)
    reason: Optional[str] = Field(default=None, max_length=300)


class CreditDecisionRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=300)


class RecordRepaymentRequest(BaseModel):
    amount: int = Field(gt=0)
    note: Optional[str] = Field(default=None, max_length=200)

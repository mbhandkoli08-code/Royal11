"""Pydantic request/response schemas + the enums that mirror the spec's role
hierarchy and ledger transaction types.
"""
from datetime import datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class Role(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    MANAGER = "MANAGER"
    ADMIN = "ADMIN"
    PLAYER = "PLAYER"


class UserStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"
    SUSPENDED = "SUSPENDED"


class TxnType(str, Enum):
    WELCOME_BONUS = "WELCOME_BONUS"
    DAILY_BONUS = "DAILY_BONUS"
    ACHIEVEMENT = "ACHIEVEMENT"
    SUPER_ADMIN_TO_MANAGER = "SUPER_ADMIN_TO_MANAGER"
    MANAGER_TO_ADMIN = "MANAGER_TO_ADMIN"
    ADMIN_GRANT = "ADMIN_GRANT"
    ADMIN_RECHARGE = "ADMIN_RECHARGE"
    DEPOSIT_TOPUP = "DEPOSIT_TOPUP"
    REFERRAL_BONUS = "REFERRAL_BONUS"
    GAME_ENTRY = "GAME_ENTRY"
    GAME_REWARD = "GAME_REWARD"
    FANTASY_ENTRY = "FANTASY_ENTRY"
    FANTASY_REWARD = "FANTASY_REWARD"
    REVERSAL = "REVERSAL"


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


class UpdateManagerQuotaRequest(BaseModel):
    authorized_quota: int = Field(ge=0)


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


# ---------------------------------------------------------------------------
# Collection bank account (Part 1b)
# ---------------------------------------------------------------------------
class BankAccountInput(BaseModel):
    account_holder_name: str = Field(min_length=1, max_length=120)
    account_number: str = Field(min_length=4, max_length=34)
    ifsc: str = Field(min_length=4, max_length=15)
    bank_name: str = Field(min_length=1, max_length=120)
    is_active: bool = True


# ---------------------------------------------------------------------------
# Revenue split + settlement (Part 2)
# ---------------------------------------------------------------------------
class RevenueSplitRequest(BaseModel):
    revenue_split_super_admin_pct: int = Field(ge=0, le=100)


class SettleRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=200)

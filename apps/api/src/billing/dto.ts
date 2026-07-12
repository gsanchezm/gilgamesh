import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const PLANS = ['FREE', 'STARTER', 'GROWTH', 'SCALE'] as const;
const CYCLES = ['MONTHLY', 'ANNUAL'] as const;
const PRORATION_BEHAVIORS = ['create_prorations', 'always_invoice'] as const;
// Cents ceiling for a refund amount — a defensive upper bound (matches the seat/amount input caps).
const MAX_REFUND_CENTS = 100_000_000;

export class ChangePlanDto {
  @IsIn(PLANS)
  plan!: 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';

  @IsOptional()
  @IsIn(CYCLES)
  billingCycle?: 'MONTHLY' | 'ANNUAL';

  /** Slice 41: create_prorations (default) | always_invoice. Absent → the slice-40 behavior. */
  @IsOptional()
  @IsIn(PRORATION_BEHAVIORS)
  prorationBehavior?: 'create_prorations' | 'always_invoice';
}

export class UpdateSeatsDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  seats!: number;
}

/** Slice 40: the target of a read-only proration preview (same shape as a plan change). */
export class PreviewPlanChangeDto {
  @IsIn(PLANS)
  plan!: 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';

  @IsOptional()
  @IsIn(CYCLES)
  billingCycle?: 'MONTHLY' | 'ANNUAL';
}

/** Slice 40: cancel gains an opt-in prorated refund of the unused period (defaults to no refund). */
export class CancelSubscriptionDto {
  @IsOptional()
  @IsBoolean()
  refund?: boolean;
}

/** Slice 41: a partial (amount-level) refund of a paid invoice. */
export class RefundDto {
  @IsInt()
  @Min(1)
  @Max(MAX_REFUND_CENTS)
  amountCents!: number;

  /** Optional target invoice (by row id or provider invoice id); defaults to the latest paid invoice. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  invoiceId?: string;
}

/** Slice 41: a read-only refund preview (amount optional — absent previews the max refundable). */
export class PreviewRefundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_REFUND_CENTS)
  amountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  invoiceId?: string;
}

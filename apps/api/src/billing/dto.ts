import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const PLANS = ['FREE', 'STARTER', 'GROWTH', 'SCALE'] as const;
const CYCLES = ['MONTHLY', 'ANNUAL'] as const;

export class ChangePlanDto {
  @IsIn(PLANS)
  plan!: 'FREE' | 'STARTER' | 'GROWTH' | 'SCALE';

  @IsOptional()
  @IsIn(CYCLES)
  billingCycle?: 'MONTHLY' | 'ANNUAL';
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

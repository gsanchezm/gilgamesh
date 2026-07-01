import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

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

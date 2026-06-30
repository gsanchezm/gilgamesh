import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const PLANS = ['TEAM', 'PRO', 'ENTERPRISE'] as const;
const CYCLES = ['MONTHLY', 'ANNUAL'] as const;

export class ChangePlanDto {
  @IsIn(PLANS)
  plan!: 'TEAM' | 'PRO' | 'ENTERPRISE';

  @IsOptional()
  @IsIn(CYCLES)
  billingCycle?: 'MONTHLY' | 'ANNUAL';
}

export class UpdateSeatsDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  seats!: number;
}

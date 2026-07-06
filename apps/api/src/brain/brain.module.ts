import { type BrainUsageRepository, GetBrainUsage, type MembershipRepository } from '@gilgamesh/application';
import { Module } from '@nestjs/common';
import { TOKENS as T } from '../persistence/tokens';
import { BrainUsageController } from './brain.controller';

/** Wires the slice-9 brain-usage view (keystone v0.3 B1) to the bound ports. */
@Module({
  controllers: [BrainUsageController],
  providers: [
    {
      provide: GetBrainUsage,
      useFactory: (brainUsage: BrainUsageRepository, memberships: MembershipRepository) =>
        new GetBrainUsage({ brainUsage, memberships }),
      inject: [T.BrainUsage, T.Memberships],
    },
  ],
})
export class BrainModule {}

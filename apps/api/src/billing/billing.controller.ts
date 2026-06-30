import {
  CancelSubscription,
  ChangeSubscription,
  ConfirmCheckout,
  StartCheckout,
  type SubscriptionView,
  UpdateSeats,
} from '@gilgamesh/application';
import { Body, Controller, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ChangePlanDto, UpdateSeatsDto } from './dto';

@Controller('orgs/:orgId/subscription')
@UseGuards(SessionAuthGuard)
export class BillingController {
  constructor(
    private readonly changeSubscription: ChangeSubscription,
    private readonly updateSeats: UpdateSeats,
    private readonly startCheckout: StartCheckout,
    private readonly confirmCheckout: ConfirmCheckout,
    private readonly cancelSubscription: CancelSubscription,
  ) {}

  @Patch()
  change(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: ChangePlanDto,
  ): Promise<SubscriptionView> {
    return this.changeSubscription.execute({ userId, orgId, plan: dto.plan, billingCycle: dto.billingCycle });
  }

  @Patch('seats')
  seats(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: UpdateSeatsDto,
  ): Promise<SubscriptionView> {
    return this.updateSeats.execute({ userId, orgId, seats: dto.seats });
  }

  @Post('checkout')
  @HttpCode(200)
  checkout(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<{ checkoutUrl: string }> {
    return this.startCheckout.execute({ userId, orgId });
  }

  @Post('checkout/confirm')
  confirm(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<SubscriptionView> {
    return this.confirmCheckout.execute({ userId, orgId });
  }

  @Post('cancel')
  cancel(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<SubscriptionView> {
    return this.cancelSubscription.execute({ userId, orgId });
  }
}

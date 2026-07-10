import {
  CancelSubscription,
  ChangeSubscription,
  ConfirmCheckout,
  type PlanChangePreview,
  PreviewPlanChange,
  StartCheckout,
  type SubscriptionView,
  UpdateSeats,
} from '@gilgamesh/application';
import { Body, Controller, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CancelSubscriptionDto, ChangePlanDto, PreviewPlanChangeDto, UpdateSeatsDto } from './dto';

@Controller('orgs/:orgId/subscription')
@UseGuards(SessionAuthGuard)
export class BillingController {
  constructor(
    private readonly changeSubscription: ChangeSubscription,
    private readonly previewPlanChange: PreviewPlanChange,
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

  // Slice 40: a read-only proration estimate before the user confirms a plan change. POST (not GET)
  // because it is behind the CSRF double-submit like the other billing mutations, though it mutates
  // nothing.
  @Post('preview')
  @HttpCode(200)
  preview(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: PreviewPlanChangeDto,
  ): Promise<PlanChangePreview> {
    return this.previewPlanChange.execute({ userId, orgId, plan: dto.plan, billingCycle: dto.billingCycle });
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
  @HttpCode(200)
  confirm(@CurrentUser() userId: string, @Param('orgId') orgId: string): Promise<SubscriptionView> {
    return this.confirmCheckout.execute({ userId, orgId });
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() userId: string,
    @Param('orgId') orgId: string,
    @Body() dto: CancelSubscriptionDto,
  ): Promise<SubscriptionView> {
    return this.cancelSubscription.execute({ userId, orgId, refund: dto.refund });
  }
}

import {
  type AuditLogRepository,
  CancelSubscription,
  ChangeSubscription,
  type Clock,
  ConfirmCheckout,
  type IdGenerator,
  type InvoiceRepository,
  ListInvoices,
  type MembershipRepository,
  type PaymentProvider,
  PreviewPlanChange,
  StartBillingPortal,
  StartCheckout,
  type SubscriptionRepository,
  UpdateSeats,
} from '@gilgamesh/application';
import { Module, type Provider } from '@nestjs/common';
import { TOKENS as T } from '../persistence/tokens';
import { BillingController } from './billing.controller';
import { BillingPortalController } from './billing-portal.controller';
import { BillingWebhooksController } from './billing-webhooks.controller';
import { InvoicesController } from './invoices.controller';

type Ctor<U> = new (deps: {
  subscriptions: SubscriptionRepository;
  memberships: MembershipRepository;
  payment: PaymentProvider;
  audit: AuditLogRepository;
  ids: IdGenerator;
  clock: Clock;
}) => U;

// All subscription use cases share the same deps bundle.
function subProvider<U>(UseCase: Ctor<U>): Provider {
  return {
    provide: UseCase,
    useFactory: (
      subscriptions: SubscriptionRepository,
      memberships: MembershipRepository,
      payment: PaymentProvider,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new UseCase({ subscriptions, memberships, payment, audit, ids, clock }),
    inject: [T.Subscriptions, T.Memberships, T.Payment, T.Audit, T.Ids, T.Clock],
  };
}

/**
 * Wires the slice-4 subscription/billing use cases + the slice-13 payments surface (invoices list
 * and the provider webhook sink) to the bound ports. The PaymentProvider itself is selected by the
 * persistence wiring (`paymentsFromEnv`: mock offline, Stripe in auto).
 */
@Module({
  controllers: [BillingController, BillingPortalController, InvoicesController, BillingWebhooksController],
  providers: [
    subProvider(ChangeSubscription),
    subProvider(PreviewPlanChange),
    subProvider(UpdateSeats),
    subProvider(StartCheckout),
    subProvider(StartBillingPortal),
    subProvider(ConfirmCheckout),
    subProvider(CancelSubscription),
    {
      provide: ListInvoices,
      useFactory: (invoices: InvoiceRepository, memberships: MembershipRepository) =>
        new ListInvoices({ invoices, memberships }),
      inject: [T.Invoices, T.Memberships],
    },
  ],
})
export class BillingModule {}

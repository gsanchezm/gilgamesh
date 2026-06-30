import {
  type AuditLogRepository,
  CancelSubscription,
  ChangeSubscription,
  type Clock,
  ConfirmCheckout,
  type IdGenerator,
  type MembershipRepository,
  type PaymentProvider,
  StartCheckout,
  type SubscriptionRepository,
  UpdateSeats,
} from '@gilgamesh/application';
import { Module, type Provider } from '@nestjs/common';
import { TOKENS as T } from '../persistence/tokens';
import { BillingController } from './billing.controller';

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

/** Wires the slice-4 subscription/billing use cases (mock PaymentProvider) to the bound ports. */
@Module({
  controllers: [BillingController],
  providers: [
    subProvider(ChangeSubscription),
    subProvider(UpdateSeats),
    subProvider(StartCheckout),
    subProvider(ConfirmCheckout),
    subProvider(CancelSubscription),
  ],
})
export class BillingModule {}

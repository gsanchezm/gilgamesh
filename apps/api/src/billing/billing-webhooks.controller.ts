import { ApplicationError, type PaymentProvider } from '@gilgamesh/application';
import { Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TOKENS } from '../persistence/tokens';

/**
 * Keystone §6 v0.5: `POST /billing/webhooks/{provider}` — deliberately UNAUTHENTICATED (Stripe has
 * no session; the global CsrfGuard exempts cookie-less requests) but PROVIDER-SIGNED: the bound
 * PaymentProvider verifies the `stripe-signature` header against the RAW body bytes, which the
 * body-parser wiring preserves as a Buffer for this path (see common/body-parser.ts).
 */
@Controller('billing/webhooks')
export class BillingWebhooksController {
  constructor(@Inject(TOKENS.Payment) private readonly payment: PaymentProvider) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: Request,
  ): Promise<{ received: boolean }> {
    // `stripe` first (keystone §6); any other provider segment is an unknown resource.
    if (provider !== 'stripe') throw new ApplicationError('NOT_FOUND', 'Unknown payment provider.');
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body)) {
      // Defensive: a harness that skipped configureBodyParser would hand us parsed JSON here —
      // signature verification over re-serialized bytes would be meaningless, so refuse.
      throw new ApplicationError('VALIDATION', 'Webhook verification requires the raw request body.');
    }
    await this.payment.handleWebhook(signature ?? '', body);
    return { received: true };
  }
}

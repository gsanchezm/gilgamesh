import { Global, Module } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';

/** Makes the session guard injectable wherever a controller declares @UseGuards(SessionAuthGuard). */
@Global()
@Module({
  providers: [SessionAuthGuard],
  exports: [SessionAuthGuard],
})
export class SecurityModule {}

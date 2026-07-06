import { randomBytes } from 'node:crypto';
import {
  FORGOT_PASSWORD_MESSAGE,
  GetMe,
  LoginUser,
  LogoutUser,
  type MeView,
  RegisterUser,
  RequestPasswordReset,
  ResetPassword,
} from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CSRF_COOKIE, SESSION_COOKIE } from './cookie-names';
import { CurrentUser, SessionId } from './current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionAuthGuard } from './session-auth.guard';

function setSessionCookie(res: Response, token: string, maxAgeMs?: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  });
}

// Non-HttpOnly companion cookie for the double-submit CSRF check (must be readable by the SPA).
// maxAge tracks the session cookie on login so it isn't dropped on browser close while the session
// persists; it is also re-minted on GET /auth/me so a restored session always has a usable token.
function setCsrfCookie(res: Response, maxAgeMs?: number): void {
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  });
}

// Cleared with matching attributes so the __Host- session + csrf cookies both clear.
function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
  res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: true, sameSite: 'lax', path: '/' });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUser,
    private readonly loginUser: LoginUser,
    private readonly getMe: GetMe,
    private readonly logoutUser: LogoutUser,
    private readonly requestPasswordReset: RequestPasswordReset,
    private readonly resetPassword: ResetPassword,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string }> {
    const { userId, sessionToken } = await this.registerUser.execute(dto);
    setSessionCookie(res, sessionToken);
    setCsrfCookie(res);
    return { userId };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string; activeOrgId: string | null }> {
    const result = await this.loginUser.execute({
      email: dto.email,
      password: dto.password,
      rememberMe: dto.rememberMe,
    });
    const maxAgeMs = result.expiresAt.getTime() - Date.now();
    setSessionCookie(res, result.sessionToken, maxAgeMs);
    setCsrfCookie(res, maxAgeMs);
    return { userId: result.userId, activeOrgId: result.activeOrgId };
  }

  // Public, rate-limited (LIMITED_PATHS), CSRF-exempt (PUBLIC_AUTH). Always the same generic
  // 202 regardless of whether the account exists (AC-AUTH-10 — no enumeration).
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.requestPasswordReset.execute({ email: dto.email });
    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  // Public, rate-limited, CSRF-exempt. Valid token -> 204 (new hash, ALL sessions revoked,
  // token consumed); invalid/expired/consumed -> 422 via the Problem filter (AC-AUTH-11/12).
  @Post('reset-password')
  @HttpCode(204)
  async resetPasswordRoute(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.resetPassword.execute({ token: dto.token, newPassword: dto.newPassword });
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(
    @CurrentUser() userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeView> {
    // Re-mint the double-submit token so a session restored from the httpOnly cookie (e.g. after a
    // browser restart that dropped the csrf cookie) can still perform mutations.
    setCsrfCookie(res);
    return this.getMe.execute({ userId });
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard)
  async logout(
    @CurrentUser() userId: string,
    @SessionId() sessionId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.logoutUser.execute({ userId, sessionId });
    clearSessionCookie(res);
  }
}

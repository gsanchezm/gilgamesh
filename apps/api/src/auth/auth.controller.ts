import { randomBytes } from 'node:crypto';
import { GetMe, LoginUser, LogoutUser, type MeView, RegisterUser } from '@gilgamesh/application';
import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, SessionId } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SessionAuthGuard } from './session-auth.guard';

const SESSION_COOKIE = '__Host-gg_session';
const CSRF_COOKIE = 'csrf';

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
function setCsrfCookie(res: Response): void {
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    path: '/',
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
    setSessionCookie(res, result.sessionToken, result.expiresAt.getTime() - Date.now());
    setCsrfCookie(res);
    return { userId: result.userId, activeOrgId: result.activeOrgId };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@CurrentUser() userId: string): Promise<MeView> {
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

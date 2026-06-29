import { LoginUser, RegisterUser } from '@gilgamesh/application';
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const SESSION_COOKIE = '__Host-gg_session';

function setSessionCookie(res: Response, token: string, maxAgeMs?: number): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  });
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUser,
    private readonly loginUser: LoginUser,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string }> {
    const { userId, sessionToken } = await this.registerUser.execute(dto);
    setSessionCookie(res, sessionToken);
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
    return { userId: result.userId, activeOrgId: result.activeOrgId };
  }
}

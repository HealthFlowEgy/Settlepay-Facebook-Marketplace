import { Controller, Get, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { PrismaService } from '../common/prisma.service';
import { IsOptional, IsString, IsEmail } from 'class-validator';

class UpdateProfileDto {
  @IsOptional() @IsString()  firstName?: string;
  @IsOptional() @IsString()  lastName?: string;
  @IsOptional() @IsEmail()   email?: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('profile')
  getProfile(@Req() req: any) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: req.user.sub },
      select: {
        id: true, mobile: true, firstName: true, lastName: true,
        email: true, isProvider: true, kycTier: true, kycStatus: true,
        facebookName: true, createdAt: true, monthlyVolume: true,
        _count: {
          select: {
            dealsAsSeller: true,
            dealsAsBuyer: true,
          },
        },
      },
    });
  }

  @Patch('profile')
  updateProfile(@Req() req: any, @Body() dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: req.user.sub },
      data:  dto,
      select: { id: true, firstName: true, lastName: true, email: true },
    });
  }

  @Get(':id/public')
  getPublicProfile(@Param('id') id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true, firstName: true, lastName: true, isProvider: true,
        kycTier: true, kycStatus: true, createdAt: true,
        _count: { select: { dealsAsSeller: true } },
      },
    });
  }
}

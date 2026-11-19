import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.service';
import { CurrentUser, SessionGuard } from '../auth/session';
import { DashboardService } from './dashboard.service';
import { CreateDestinationDto, CreateSourceDto, ListEventsQuery, UpdateDestinationDto, UpdateSourceDto } from './dto';

const Id = () => Param('id', new ParseUUIDPipe());

@Controller('api')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get('stats') stats(@CurrentUser() u: AuthUser) { return this.svc.stats(u.id); }

  @Get('sources') listSources(@CurrentUser() u: AuthUser) { return this.svc.listSources(u.id); }
  @Post('sources') createSource(@CurrentUser() u: AuthUser, @Body() dto: CreateSourceDto) { return this.svc.createSource(u.id, dto); }
  @Patch('sources/:id') updateSource(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdateSourceDto) { return this.svc.updateSource(u.id, id, dto); }
  @Delete('sources/:id') @HttpCode(204) deleteSource(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.deleteSource(u.id, id); }
  @Post('sources/:id/rotate-secret') rotateInbound(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.rotateInboundSecret(u.id, id); }
  @Delete('sources/:id/secret') @HttpCode(204) disableInbound(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.disableInboundSignature(u.id, id); }

  @Post('sources/:id/destinations') addDestination(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: CreateDestinationDto) { return this.svc.addDestination(u.id, id, dto.url); }
  @Patch('destinations/:id') @HttpCode(204) updateDestination(@CurrentUser() u: AuthUser, @Id() id: string, @Body() dto: UpdateDestinationDto) { return this.svc.setDestinationEnabled(u.id, id, dto.enabled); }
  @Delete('destinations/:id') @HttpCode(204) deleteDestination(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.deleteDestination(u.id, id); }
  @Post('destinations/:id/rotate-secret') rotateDestination(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.rotateDestinationSecret(u.id, id); }

  @Get('events') listEvents(@CurrentUser() u: AuthUser, @Query() q: ListEventsQuery) { return this.svc.listEvents(u.id, q); }
  @Get('events/:id') getEvent(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.getEvent(u.id, id); }
  @Post('events/:id/replay') replayEvent(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.replayEvent(u.id, id); }

  @Get('dead-letters') listDead(@CurrentUser() u: AuthUser) { return this.svc.listDead(u.id); }
  @Post('dead-letters/replay') replayAll(@CurrentUser() u: AuthUser) { return this.svc.replayAllDead(u.id); }
  @Post('deliveries/:id/replay') replayDelivery(@CurrentUser() u: AuthUser, @Id() id: string) { return this.svc.replayDeliveries(u.id, [id]); }
}

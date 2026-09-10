import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { FlightController } from './flight.controller';
import { AvailabilityService } from './use-cases/availability.service';
import { BookingService } from './use-cases/booking.service';
import { FareRulesService } from './use-cases/fare-rules.service';
import { PingService } from './use-cases/ping.service';
import { QuoteService } from './use-cases/quote.service';
import { RetrieveService } from './use-cases/retrieve.service';
import { CancelBookingService } from './use-cases/cancel-booking.service';
import { SeatMapService } from './use-cases/seat-map.service';
import { AncillariesService } from './use-cases/ancillaries.service';

@Module({
  imports: [ProvidersModule],
  controllers: [FlightController],
  providers: [AvailabilityService, QuoteService, BookingService, RetrieveService, CancelBookingService, SeatMapService, AncillariesService, FareRulesService, PingService],
})
export class FlightModule {}

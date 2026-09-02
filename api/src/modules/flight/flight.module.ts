import { Module } from '@nestjs/common';
import { TravelfusionModule } from '../travelfusion/travelfusion.module';
import { FlightController } from './flight.controller';
import { AvailabilityService } from './use-cases/availability.service';
import { BookingService } from './use-cases/booking.service';
import { FareRulesService } from './use-cases/fare-rules.service';
import { QuoteService } from './use-cases/quote.service';
import { RetrieveService } from './use-cases/retrieve.service';

@Module({
  imports: [TravelfusionModule],
  controllers: [FlightController],
  providers: [AvailabilityService, QuoteService, BookingService, RetrieveService, FareRulesService],
})
export class FlightModule {}

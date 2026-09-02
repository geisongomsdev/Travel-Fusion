import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsObject, IsOptional, IsString, Matches, ValidateNested,
} from 'class-validator';

export class QuoteDto {
  @ApiProperty({ description: 'O identifier opaco vindo da busca. Devolva intacto, nunca interprete.' })
  @IsString()
  identifier!: string;
}

export class BookingPassengerDto {
  @ApiPropertyOptional({ example: 'Mr' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ example: 'Andy' })
  @IsString()
  firstName!: string;

  @ApiProperty({ example: 'Peterson' })
  @IsString()
  lastName!: string;

  @ApiProperty({ example: '1990-04-21', description: 'YYYY-MM-DD. A idade é calculada na data do voo.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}/, { message: 'dateOfBirth deve começar em YYYY-MM-DD' })
  dateOfBirth!: string;

  @ApiPropertyOptional({
    description: 'CSPs por passageiro (PerPassenger=true), ex.: OutwardLuggageOptions.',
    example: { OutwardLuggageOptions: '2' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

export class CreateBookingDto {
  @ApiProperty({ description: 'O identifier opaco da oferta tarifada.' })
  @IsString()
  identifier!: string;

  @ApiPropertyOptional({
    example: '2026-10-12',
    description: 'Data usada para calcular a idade real. Em ida-e-volta, a data da VOLTA.',
  })
  @IsOptional()
  @IsString()
  referenceDate?: string;

  @ApiProperty({ type: [BookingPassengerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BookingPassengerDto)
  passengers!: BookingPassengerDto[];

  @ApiPropertyOptional({
    description: 'CSPs do nível da reserva (PerPassenger=false).',
    example: { LuggageOptions: '1' },
  })
  @IsOptional()
  @IsObject()
  customParameters?: Record<string, string>;
}

export class RetrieveBookingAddressDto {
  @ApiProperty({ example: 'NW6PFQ', description: 'O localizador. Todo provedor usa.' })
  @IsString()
  locator!: string;

  @ApiPropertyOptional({ description: 'Sobrenome do passageiro principal.' })
  @IsOptional()
  @IsString()
  lastName?: string;
}

export class RetrieveOptionsDto {
  @ApiPropertyOptional({ example: 'travelfusion' })
  @IsOptional()
  @IsString()
  provider?: string;
}

export class RetrieveDto {
  @ApiPropertyOptional({ type: RetrieveOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => RetrieveOptionsDto)
  options?: RetrieveOptionsDto;

  /**
   * 🔴 O bloco `booking` é deliberadamente TOLERANTE: campo desconhecido aqui é
   * ignorado, não recusado, porque cada companhia pede um conjunto diferente e
   * quem consome manda o superconjunto. Por isso ele fica fora do whitelist do
   * ValidationPipe (ver `forbidNonWhitelisted` no main.ts).
   */
  @ApiProperty({ type: RetrieveBookingAddressDto })
  @ValidateNested()
  @Type(() => RetrieveBookingAddressDto)
  booking!: RetrieveBookingAddressDto;
}

export class FareRulesKeyDto {
  @ApiProperty({ description: 'A chave opaca vinda de fares[].rules.key da busca.' })
  @IsString()
  key!: string;
}

export class FareRulesDto {
  @ApiPropertyOptional({ example: 'travelfusion' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiProperty({ type: FareRulesKeyDto, description: 'Fechado: nenhum outro campo aqui dentro.' })
  @ValidateNested()
  @Type(() => FareRulesKeyDto)
  fareRules!: FareRulesKeyDto;
}

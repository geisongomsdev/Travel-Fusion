import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min,
  ValidateNested,
} from 'class-validator';

export type TripType = 'oneway' | 'roundtrip' | 'multicity';

export class LegDto {
  @ApiProperty({ example: 'GRU', description: 'IATA de origem.' })
  @IsString()
  @Length(3, 3)
  origin!: string;

  @ApiProperty({ example: 'REC', description: 'IATA de destino.' })
  @IsString()
  @Length(3, 3)
  destination!: string;

  @ApiProperty({ example: '2026-10-12', description: 'Data de partida, YYYY-MM-DD.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date deve estar no formato YYYY-MM-DD' })
  date!: string;
}

export class PassengersDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  adults!: number;

  @ApiPropertyOptional({ example: 0, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({ example: 0, minimum: 0, description: 'Bebês de colo.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  babies?: number;
}

export class AvailabilityOptionsDto {
  @ApiPropertyOptional({ example: ['travelfusion'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  provider?: string[];

  @ApiPropertyOptional({ description: 'Filtra por ofertas reembolsáveis.' })
  @IsOptional()
  @IsBoolean()
  refundable?: boolean;

  @ApiPropertyOptional({ enum: ['economy', 'premium_economy', 'business', 'first'] })
  @IsOptional()
  @IsIn(['economy', 'premium_economy', 'business', 'first'])
  class?: string;
}

export class AvailabilityDto {
  @ApiProperty({ enum: ['oneway', 'roundtrip', 'multicity'] })
  @IsIn(['oneway', 'roundtrip', 'multicity'])
  type!: TripType;

  @ApiProperty({ type: [LegDto], description: 'Um item na ida; dois na ida-e-volta; N no multidestino.' })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LegDto)
  legs!: LegDto[];

  @ApiProperty({ type: PassengersDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PassengersDto)
  passengers!: PassengersDto;

  @ApiPropertyOptional({ type: AvailabilityOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AvailabilityOptionsDto)
  options?: AvailabilityOptionsDto;
}

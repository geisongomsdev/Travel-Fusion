import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsNotEmptyObject, IsString, ValidateNested } from 'class-validator';

export type PingEnvironment = 'sandbox' | 'production';

export class PingOptionsDto {
  @ApiProperty({ example: 'travelfusion' })
  @IsString()
  provider!: string;
}

export class PingProbeDto {
  @ApiProperty({
    enum: ['sandbox', 'production'],
    description: 'Escolhe o ambiente da companhia. Sem ele o teste bateria num ambiente arbitrário.',
  })
  @IsIn(['sandbox', 'production'])
  environment!: PingEnvironment;

  /**
   * Shape LIVRE de propósito (13-fare-rules-e-ping §B2): cada companhia pede um
   * conjunto diferente, e quem valida completude é a própria sonda. Exigimos só
   * que seja um objeto com ao menos uma chave.
   */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { username: 'passapi' },
    description: 'As credenciais a testar. Shape livre, ≥1 chave.',
  })
  @IsNotEmptyObject()
  credentials!: Record<string, unknown>;
}

export class PingDto {
  @ApiProperty({ type: PingOptionsDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PingOptionsDto)
  options!: PingOptionsDto;

  @ApiProperty({ type: PingProbeDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PingProbeDto)
  ping!: PingProbeDto;
}

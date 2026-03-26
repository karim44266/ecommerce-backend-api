import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PAYMENT_METHODS, SETTLEMENT_STATUSES } from '../schemas/settlement.schema';

// ────────────────────────────────────────────────────────────────
//  Declare Payment (Reseller)
// ────────────────────────────────────────────────────────────────

export class DeclarePaymentDto {
  @ApiProperty({
    description: 'Array of order IDs covered by this payment',
    example: ['665a1b2c3d4e5f6a7b8c9d0e'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  orderIds: string[];

  @ApiProperty({
    description: 'Payment method',
    enum: PAYMENT_METHODS,
    example: 'bank_transfer',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(PAYMENT_METHODS)
  method: string;

  @ApiPropertyOptional({
    description: 'Payment reference (bank transfer ref, check number, etc.)',
    example: 'VIR-2026-03-25-001',
  })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiPropertyOptional({
    description: 'Optional note from the reseller',
    example: 'Payment for March deliveries',
  })
  @IsOptional()
  @IsString()
  note?: string;
}

// ────────────────────────────────────────────────────────────────
//  Validate Payment (Admin / ERP)
// ────────────────────────────────────────────────────────────────

export class ValidatePaymentDto {
  @ApiProperty({
    description: 'Validation result',
    enum: ['VALIDATED', 'REJECTED'],
    example: 'VALIDATED',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['VALIDATED', 'REJECTED'])
  status: 'VALIDATED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'ERP payment reference (required when validating)',
    example: 'ERP-PAY-12345',
  })
  @IsOptional()
  @IsString()
  erpReference?: string;

  @ApiPropertyOptional({
    description: 'Reason for rejection (required when rejecting)',
    example: 'Payment amount does not match',
  })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

// ────────────────────────────────────────────────────────────────
//  ERP Webhook Validate
// ────────────────────────────────────────────────────────────────

export class ErpValidatePaymentDto {
  @ApiProperty({
    description: 'Settlement ID to validate',
    example: '665a1b2c3d4e5f6a7b8c9d0e',
  })
  @IsString()
  @IsNotEmpty()
  settlementId: string;

  @ApiProperty({
    description: 'Validation result',
    enum: ['VALIDATED', 'REJECTED'],
    example: 'VALIDATED',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['VALIDATED', 'REJECTED'])
  status: 'VALIDATED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'ERP payment reference' })
  @IsOptional()
  @IsString()
  erpReference?: string;

  @ApiPropertyOptional({ description: 'Rejection reason' })
  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

// ────────────────────────────────────────────────────────────────
//  Query DTOs
// ────────────────────────────────────────────────────────────────

export class FinanceQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter from date (ISO)', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO)', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Filter by settlement status',
    enum: SETTLEMENT_STATUSES,
  })
  @IsOptional()
  @IsString()
  @IsIn([...SETTLEMENT_STATUSES, ''])
  status?: string;
}

export class ExportQueryDto {
  @ApiProperty({ description: 'Export start date (ISO)', example: '2026-01-01' })
  @IsString()
  @IsNotEmpty()
  from: string;

  @ApiProperty({ description: 'Export end date (ISO)', example: '2026-12-31' })
  @IsString()
  @IsNotEmpty()
  to: string;

  @ApiPropertyOptional({
    description: 'Export format',
    enum: ['csv', 'pdf'],
    default: 'csv',
  })
  @IsOptional()
  @IsString()
  @IsIn(['csv', 'pdf'])
  format?: string;
}

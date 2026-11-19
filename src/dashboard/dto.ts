import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSourceDto {
  @IsString() @Length(1, 100) name: string;
  @IsOptional() @IsString() @MaxLength(2048) destinationUrl?: string;
  @IsOptional() @IsBoolean() requireSignature?: boolean;
}

export class UpdateSourceDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsObject() transform?: Record<string, unknown> | null;
  @IsOptional() @IsBoolean() clearTransform?: boolean;
}

export class CreateDestinationDto {
  @IsString() @MaxLength(2048) url: string;
}

export class UpdateDestinationDto {
  @IsBoolean() enabled: boolean;
}

export class ListEventsQuery {
  @IsOptional() @IsUUID() sourceId?: string;
  @IsOptional() @IsIn(['pending', 'retrying', 'succeeded', 'dead']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) before?: string;
}

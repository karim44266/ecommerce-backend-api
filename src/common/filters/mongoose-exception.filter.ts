import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { Error as MongooseError } from 'mongoose';

/**
 * Catches Mongoose CastError (e.g. invalid ObjectId) and returns
 * a proper 400 response instead of an unhandled 500.
 */
@Catch(MongooseError.CastError)
export class MongooseCastErrorFilter implements ExceptionFilter {
  catch(exception: MongooseError.CastError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: `Invalid ${exception.path}: "${exception.value}" is not a valid ID`,
      error: 'Bad Request',
    });
  }
}

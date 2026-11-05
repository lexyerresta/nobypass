import { Body, Controller, Get, Post } from '@nestjs/common';
import { UsersService } from '@app/users/users.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.listActive();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.register(dto);
  }
}

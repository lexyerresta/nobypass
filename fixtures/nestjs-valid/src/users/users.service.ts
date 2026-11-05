import { ConflictException, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  listActive() {
    return this.repository.findActive();
  }

  async register(dto: CreateUserDto) {
    try {
      return await this.repository.create(dto);
    } catch (error) { // nobypass-allow EXC001: translate unique-constraint error into a 409
      throw new ConflictException(`User ${dto.email} already exists`, { cause: error });
    }
  }
}

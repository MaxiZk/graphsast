import { Controller, Get, Query, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class UsersService {
  constructor(private readonly dataSource: DataSource) {}

  findByEmail(email: string) {
    return this.dataSource.query("SELECT * FROM users WHERE email = $1", [email]);
  }
}

@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  find(@Query("email") email: string) {
    return this.users.findByEmail(email);
  }
}

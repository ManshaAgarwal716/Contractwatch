from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class User(BaseModel):
    id: int
    name: str
    avatar: str | None = None

class CreateUser(BaseModel):
    name: str
    email: str

@app.get('/api/users/me', response_model=User)
async def get_user():
    pass

@app.get('/api/users/list', response_model=list[User])
async def list_users():
    pass

@app.post('/api/users', response_model=User)
async def create_user(payload: CreateUser):
    pass

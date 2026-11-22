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
@app.post('/api/users', response_model=User)
async def create_user(payload: CreateUser):
    pass

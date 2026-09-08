FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY services/Fulfil/Fulfil.csproj services/Fulfil/
RUN dotnet restore services/Fulfil/Fulfil.csproj
COPY services/Fulfil services/Fulfil
RUN dotnet publish services/Fulfil -c Release -o /out --no-restore
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
EXPOSE 5080
ENTRYPOINT ["dotnet","Fulfil.dll"]

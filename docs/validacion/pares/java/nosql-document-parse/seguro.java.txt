import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.Filters;
import org.bson.Document;
import org.springframework.web.bind.annotation.*;

@RestController
public class PedidoController {
    private MongoCollection<Document> pedidos;

    @PostMapping("/pedidos/buscar")
    public Object buscar(@RequestParam String cliente) {
        return pedidos.find(Filters.eq("cliente", cliente)).first();
    }
}
